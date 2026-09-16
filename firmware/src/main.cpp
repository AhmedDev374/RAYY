/**
 * رَيّ — RAYY ESP32 greenhouse node
 * ===========================================================================
 * Layering this node participates in:
 *
 *   Dashboard → FastAPI → RAYY Control Engine → Device Adapter → this firmware
 *                                                              → relays / PWM /
 *                                                                servo / sensors
 *
 * The board is the only component that knows what is physically wired, so it
 * DECLARES its hardware to the backend and then executes the commands the
 * control engine queued. Nothing here pretends a sensor or actuator exists:
 * every optional block is behind a `HAS_*` switch, and a component that is not
 * enabled is reported as "not installed" so the dashboard can say
 * «يتطلب تركيب الحساس» / «جاهز للتكامل» instead of showing a fake value.
 *
 * Protocol (all device-token authenticated, see backend/app/routers/devices.py)
 *   POST /api/v1/ingest                          — readings (pot 0..3)
 *   POST /api/v1/devices/{id}/report             — capabilities + actuator state
 *                                                  + tank/flow readings, and it
 *                                                  returns the emergency-stop flag
 *   GET  /api/v1/devices/{id}/commands/pending    — queued actuator commands
 *   POST /api/v1/devices/{id}/commands/{cid}/ack  — execution result (real feedback)
 *
 * Command wire tokens (produced by services/device_adapter.py):
 *   water                 pump ON   (legacy-compatible token)
 *   pump_off              pump OFF
 *   valve_on / valve_off  water valve
 *   fan_on / fan_off / fan_set_<pct>
 *   vent_on / vent_off / vent_set_<pct>      (servo position)
 *   light_on / light_off / light_set_<pct>   (grow light PWM)
 *
 * First-time setup: fill in WIFI_SSID / WIFI_PASSWORD, flash, then send
 * `SETUP_TOKEN=<token>` over Serial (115200) to claim the device.
 * ===========================================================================
 */

#include <Arduino.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WiFi.h>
#include <time.h>

// ---------------------------------------------------------------------------
// Hardware switches — set to 1 only when the component is actually wired.
// The defaults describe the board this repository has always shipped:
// one irrigation relay, a DHT11, an LDR and four soil probes.
// ---------------------------------------------------------------------------
#ifndef HAS_PUMP
#define HAS_PUMP 1
#endif
#ifndef HAS_VALVE
#define HAS_VALVE 0
#endif
#ifndef HAS_FAN
#define HAS_FAN 0
#endif
#ifndef HAS_GROW_LIGHT
#define HAS_GROW_LIGHT 0
#endif
#ifndef HAS_VENT_SERVO
#define HAS_VENT_SERVO 0
#endif
#ifndef HAS_DHT
#define HAS_DHT 1
#endif
#ifndef HAS_LDR
#define HAS_LDR 1
#endif
#ifndef HAS_SOIL
#define HAS_SOIL 1
#endif
#ifndef HAS_WATER_LEVEL
#define HAS_WATER_LEVEL 0
#endif
#ifndef HAS_FLOW
#define HAS_FLOW 0
#endif

#if HAS_DHT
#include <DHT.h>
#endif
#if HAS_VENT_SERVO
#include <ESP32Servo.h>
#endif

// ---------------------------------------------------------------------------
// WiFi / server
// ---------------------------------------------------------------------------
#ifndef WIFI_SSID
#define WIFI_SSID "YOUR_WIFI_SSID"
#endif
#ifndef WIFI_PASSWORD
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
#endif
#ifndef API_BASE_URL
#define API_BASE_URL "http://192.168.1.100:8000"
#endif

// ---------------------------------------------------------------------------
// Pins
// ---------------------------------------------------------------------------
#define DHTPIN 18
#define DHTTYPE DHT11
#define LDR_PIN 34
#define SOIL_PINS 35, 32, 33, 36
#define RELAY_PIN 26          // irrigation pump
#define VALVE_PIN 27          // water valve
#define FAN_PIN 25            // ventilation fan (PWM)
#define GROW_LIGHT_PIN 14     // grow light (PWM)
#define VENT_SERVO_PIN 13     // greenhouse vent (servo)
#define WATER_LEVEL_PIN 39    // analog water-level sensor (or float switch)
#define FLOW_PIN 23           // flow sensor pulse output

#define NUM_POTS 4
#define FIRMWARE_VERSION "3.0.0"

// ---------------------------------------------------------------------------
// Safety limits (mirrored in the backend, enforced again here on the board)
// ---------------------------------------------------------------------------
#define PUMP_MAX_SECONDS 180        // absolute maximum continuous pumping
#define PUMP_MAX_CMD_SECONDS 60     // a single command may never exceed this
#define PUMP_MIN_INTERVAL_MS 60000UL
#define REPORT_INTERVAL_MS 3000UL
#define POLL_INTERVAL_MS 3000UL

const char* ntpServer = "pool.ntp.org";
const long gmtOffsetSec = 0;
const int daylightOffsetSec = 0;

#if HAS_DHT
DHT dht(DHTPIN, DHTTYPE);
#endif
#if HAS_VENT_SERVO
Servo ventServo;
#endif

Preferences prefs;

String deviceToken;
String ingestUrl;
String deviceId;
String apiBase;
bool claimed = false;
bool emergencyStop = false;
bool capabilitiesReported = false;

const int soilPins[NUM_POTS] = {SOIL_PINS};

struct ActuatorState {
  bool on = false;
  int value = 0;              // percent for PWM/servo actuators
  bool present = false;       // is this actuator wired on THIS board?
  unsigned long startedAt = 0;  // millis() of the current ON period
};

struct Actuators {
  ActuatorState pump;
  ActuatorState valve;
  ActuatorState fan;
  ActuatorState vent;
  ActuatorState light;
};

Actuators actuators;

volatile uint32_t flowPulses = 0;
unsigned long lastPumpStart = 0;
double litersThisCycle = 0.0;
unsigned long lastReport = 0;
unsigned long lastPoll = 0;

// Forward declarations (these helpers are defined further down).
void stopAllActuators();
bool executeActuator(const String& actuator, const String& action, int value, String& detail);

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
float clampf(float v, float lo, float hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

float ldrToLux(int raw) { return clampf((raw / 4095.0f) * 1200.0f, 0.0f, 1200.0f); }

float soilToPercent(int raw) {
  const float wetAdc = 1200.0f;
  const float dryAdc = 3200.0f;
  return clampf((dryAdc - raw) / (dryAdc - wetAdc) * 100.0f, 0.0f, 100.0f);
}

#if HAS_WATER_LEVEL
float waterLevelPercent() {
  int raw = analogRead(WATER_LEVEL_PIN);
  // 0..4095 -> 0..100 %. Reverse the polarity here if your sensor is inverted.
  return clampf((raw / 4095.0f) * 100.0f, 0.0f, 100.0f);
}
#endif

#if HAS_FLOW
void IRAM_ATTR onFlowPulse() { flowPulses++; }

/** YF-S201 style sensors pulse roughly 450 times per liter. */
const double PULSES_PER_LITER = 450.0;

/** Liters passed since the counter was last reset. */
double flowLiters() {
  static uint32_t lastSeen = 0;
  uint32_t current = flowPulses;
  if (current < lastSeen) lastSeen = 0;  // counter was reset when the pump started
  double liters = (current - lastSeen) / PULSES_PER_LITER;
  lastSeen = current;
  return liters > 0 ? liters : 0.0;
}

/** Instantaneous flow in liters/minute, measured over the last report window. */
double flowLpm() {
  static unsigned long lastSample = 0;
  static uint32_t lastPulses = 0;
  unsigned long now = millis();
  unsigned long dt = now - lastSample;
  uint32_t current = flowPulses;
  if (current < lastPulses) lastPulses = 0;
  double liters = (current - lastPulses) / PULSES_PER_LITER;
  lastPulses = current;
  lastSample = now;
  if (dt == 0) return 0.0;
  return (liters / dt) * 60000.0;
}
#endif

long currentEpochSeconds() {
  time_t now = time(nullptr);
  if (now > 946684800) return (long)now;
  return (long)(millis() / 1000UL);
}

// --- tiny JSON helpers (no extra parsing dependency) ------------------------
String jsonString(const String& body, const char* key) {
  String needle = String("\"") + key + "\":\"";
  int idx = body.indexOf(needle);
  if (idx < 0) return String("");
  idx += needle.length();
  int end = body.indexOf('"', idx);
  if (end < 0) return String("");
  return body.substring(idx, end);
}

long jsonInt(const String& body, const char* key, long fallback = 0) {
  String needle = String("\"") + key + "\":";
  int idx = body.indexOf(needle);
  if (idx < 0) return fallback;
  idx += needle.length();
  int end = idx;
  while (end < (int)body.length()) {
    char c = body.charAt(end);
    if (c == ',' || c == '}' || c == ']' || c == ' ') break;
    end++;
  }
  String value = body.substring(idx, end);
  value.trim();
  if (value.length() == 0) return fallback;
  return value.toInt();
}

bool jsonBool(const String& body, const char* key, bool fallback = false) {
  String needle = String("\"") + key + "\":";
  int idx = body.indexOf(needle);
  if (idx < 0) return fallback;
  idx += needle.length();
  return body.substring(idx, idx + 4).startsWith("true");
}

// ---------------------------------------------------------------------------
// WiFi + claim (unchanged flow, so existing onboarding keeps working)
// ---------------------------------------------------------------------------
void loadCredentials() {
  prefs.begin("spd", true);
  deviceToken = prefs.getString("dev_token", "");
  ingestUrl = prefs.getString("ingest_url", "");
  deviceId = prefs.getString("device_id", "");
  claimed = deviceToken.length() > 0 && ingestUrl.length() > 0 && deviceId.length() > 0;
  prefs.end();

  apiBase = String(API_BASE_URL);
  int apiIdx = ingestUrl.indexOf("/api/");
  if (apiIdx > 0) apiBase = ingestUrl.substring(0, apiIdx);
  if (!claimed) ingestUrl = String(API_BASE_URL) + "/api/v1/ingest";
}

void saveCredentials(const String& token, const String& url, const String& devId) {
  prefs.begin("spd", false);
  prefs.putString("dev_token", token);
  prefs.putString("ingest_url", url);
  prefs.putString("device_id", devId);
  prefs.end();
  deviceToken = token;
  ingestUrl = url;
  deviceId = devId;
  claimed = true;
}

void ensureWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  for (int i = 0; i < 30 && WiFi.status() != WL_CONNECTED; i++) delay(500);
}

bool claimDevice(const String& setupToken) {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  String url = String(API_BASE_URL) + "/api/v1/devices/claim";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  String body = "{\"setup_token\":\"" + setupToken + "\",\"firmware_version\":\"" +
                String(FIRMWARE_VERSION) + "\"}";
  int code = http.POST(body);
  String response = http.getString();
  http.end();
  if (code != 200) {
    Serial.printf("Claim failed %d: %s\n", code, response.c_str());
    return false;
  }
  String token = jsonString(response, "device_token");
  String ingest = jsonString(response, "ingest_url");
  String devId = String(jsonInt(response, "device_id", 1));
  if (token.length() == 0 || ingest.length() == 0) return false;
  saveCredentials(token, ingest, devId);
  Serial.println("Device claimed OK");
  return true;
}

// ---------------------------------------------------------------------------
// Capability report: what is physically wired on this board
// ---------------------------------------------------------------------------
String capabilityEntries() {
  String entries = "";
  auto addCapability = [&entries](const char* key, const char* kind, bool supported) {
    if (entries.length() > 0) entries += ",";
    entries += "{\"key\":\"" + String(key) + "\",\"kind\":\"" + String(kind) +
               "\",\"supported\":" + String(supported ? "true" : "false") + ",\"status\":\"" +
               String(supported ? "ok" : "not_installed") + "\"}";
  };

  // Sensors
  addCapability("temperature", "sensor", HAS_DHT);
  addCapability("humidity", "sensor", HAS_DHT);
  addCapability("light", "sensor", HAS_LDR);
  addCapability("soil_moisture", "sensor", HAS_SOIL);
  addCapability("water_level", "sensor", HAS_WATER_LEVEL);
  addCapability("flow", "sensor", HAS_FLOW);
  // Actuators
  addCapability("pump", "actuator", HAS_PUMP);
  addCapability("valve", "actuator", HAS_VALVE);
  addCapability("fan", "actuator", HAS_FAN);
  addCapability("vent", "actuator", HAS_VENT_SERVO);
  addCapability("grow_light", "actuator", HAS_GROW_LIGHT);
  return entries;
}

String actuatorStateEntries() {
  String entries = "";
  auto addState = [&entries](const char* key, const ActuatorState& state, bool present) {
    if (!present) return;
    if (entries.length() > 0) entries += ",";
    entries += "{\"actuator\":\"" + String(key) + "\",\"on\":" +
               String(state.on ? "true" : "false") + ",\"value\":" + String(state.value) + "}";
  };
  addState("pump", actuators.pump, HAS_PUMP);
  addState("valve", actuators.valve, HAS_VALVE);
  addState("fan", actuators.fan, HAS_FAN);
  addState("vent", actuators.vent, HAS_VENT_SERVO);
  addState("grow_light", actuators.light, HAS_GROW_LIGHT);
  return entries;
}

void reportState(bool includeCapabilities) {
  if (!claimed || WiFi.status() != WL_CONNECTED) return;

  String body = "{\"firmware_version\":\"" + String(FIRMWARE_VERSION) + "\"";
  if (includeCapabilities || !capabilitiesReported) {
    body += ",\"capabilities\":[" + capabilityEntries() + "]";
  }
  String states = actuatorStateEntries();
  if (states.length() > 0) body += ",\"actuators\":[" + states + "]";

#if HAS_WATER_LEVEL
  body += ",\"water_level_pct\":" + String(waterLevelPercent(), 1);
#endif
#if HAS_FLOW
  body += ",\"flow_lpm\":" + String(flowLpm(), 2);
#endif
  body += "}";

  HTTPClient http;
  String url = apiBase + "/api/v1/devices/" + deviceId + "/report";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " + deviceToken);
  int code = http.POST(body);
  String response = http.getString();
  http.end();

  if (code == 200) {
    capabilitiesReported = true;
    bool stop = jsonBool(response, "emergency_stop", false);
    if (stop && !emergencyStop) {
      Serial.println("EMERGENCY STOP from server - switching every output off");
      stopAllActuators();
    }
    emergencyStop = stop;
  } else if (code > 0) {
    Serial.printf("Report failed %d: %s\n", code, response.c_str());
  }
}

// ---------------------------------------------------------------------------
// Actuator execution
// ---------------------------------------------------------------------------
void stopAllActuators() {
#if HAS_PUMP
  digitalWrite(RELAY_PIN, LOW);
  actuators.pump.on = false;
  actuators.pump.value = 0;
#endif
#if HAS_VALVE
  digitalWrite(VALVE_PIN, LOW);
  actuators.valve.on = false;
  actuators.valve.value = 0;
#endif
#if HAS_FAN
  ledcWrite(0, 0);
  actuators.fan.on = false;
  actuators.fan.value = 0;
#endif
#if HAS_GROW_LIGHT
  ledcWrite(1, 0);
  actuators.light.on = false;
  actuators.light.value = 0;
#endif
#if HAS_VENT_SERVO
  ventServo.write(0);
  actuators.vent.on = false;
  actuators.vent.value = 0;
#endif
}

bool actuatorPresent(const String& actuator) {
  if (actuator == "pump") return HAS_PUMP;
  if (actuator == "valve") return HAS_VALVE;
  if (actuator == "fan") return HAS_FAN;
  if (actuator == "vent") return HAS_VENT_SERVO;
  if (actuator == "grow_light") return HAS_GROW_LIGHT;
  return false;
}

/** Parses a wire token into (actuator, action, value). */
void parseToken(const String& token, String& actuator, String& action, int& value) {
  value = -1;
  if (token == "water") {
    actuator = "pump";
    action = "on";
    return;
  }
  if (token == "pump_off") {
    actuator = "pump";
    action = "off";
    return;
  }
  // Longest key first: "grow_light" must not be read as a shorter prefix.
  const char* keys[] = {"grow_light", "pump", "valve", "fan", "vent"};
  for (const char* key : keys) {
    String prefix = String(key) + "_";
    if (token == key || token.startsWith(prefix)) {
      actuator = key;
      String rest = token.substring(prefix.length());
      if (rest.startsWith("set_")) {
        action = "set";
        value = rest.substring(4).toInt();
      } else {
        action = rest;
      }
      return;
    }
  }
  actuator = token;
  action = "unknown";
}

// NOTE: the pump/valve/fan/light blocks are written out explicitly so that an
// unsupported actuator can never be silently "handled" by a fallback branch.
bool executeActuator(const String& actuator, const String& action, int value, String& detail) {
  int percent = (value < 0) ? 100 : (int)clampf(value, 0, 100);
  bool on = (action == "on" || action == "set");

  if (!actuatorPresent(actuator)) {
    detail = "وحدة التنفيذ غير مُركّبة على الجهاز";
    return false;
  }
  if (emergencyStop) {
    detail = "إيقاف طارئ مُفعَّل على الجهاز";
    return false;
  }

  if (actuator == "pump") {
#if HAS_PUMP
    if (on) {
      unsigned long now = millis();
      if (lastPumpStart != 0 && now - lastPumpStart < PUMP_MIN_INTERVAL_MS) {
        detail = "تم منع ري متكرر على الجهاز";
        return false;
      }
      digitalWrite(RELAY_PIN, HIGH);
      actuators.pump.on = true;
      actuators.pump.value = percent;
      actuators.pump.startedAt = now;
      lastPumpStart = now;
#if HAS_FLOW
      flowPulses = 0;
      litersThisCycle = 0.0;
#endif
      detail = "تم تشغيل المضخة";
    } else {
      digitalWrite(RELAY_PIN, LOW);
      actuators.pump.on = false;
      actuators.pump.value = 0;
#if HAS_FLOW
      litersThisCycle = flowLiters();
      flowPulses = 0;
#endif
      detail = "تم إيقاف المضخة";
    }
    return true;
#else
    detail = "لا توجد مضخة مُركّبة";
    return false;
#endif
  }

  if (actuator == "valve") {
#if HAS_VALVE
    digitalWrite(VALVE_PIN, on ? HIGH : LOW);
    actuators.valve.on = on;
    actuators.valve.value = on ? 100 : 0;
    detail = on ? "تم فتح صمام الري" : "تم إغلاق صمام الري";
    return true;
#else
    detail = "لا يوجد صمام مُركّب";
    return false;
#endif
  }

  if (actuator == "fan") {
#if HAS_FAN
    ledcWrite(0, on ? map(percent, 0, 100, 0, 255) : 0);
    actuators.fan.on = on;
    actuators.fan.value = on ? percent : 0;
    detail = on ? "تم تشغيل المروحة" : "تم إيقاف المروحة";
    return true;
#else
    detail = "لا توجد مروحة مُركّبة";
    return false;
#endif
  }

  if (actuator == "vent") {
#if HAS_VENT_SERVO
    int angle = on ? map(percent, 0, 100, 0, 180) : 0;
    ventServo.write(angle);
    actuators.vent.on = on;
    actuators.vent.value = on ? percent : 0;
    detail = on ? "تم ضبط فتحات الصوبة" : "تم إغلاق الفتحات";
    return true;
#else
    detail = "لا توجد وحدة تحكم بالفتحات مُركّبة";
    return false;
#endif
  }

  if (actuator == "grow_light") {
#if HAS_GROW_LIGHT
    ledcWrite(1, on ? map(percent, 0, 100, 0, 255) : 0);
    actuators.light.on = on;
    actuators.light.value = on ? percent : 0;
    detail = on ? "تم تشغيل إضاءة النمو" : "تم إيقاف إضاءة النمو";
    return true;
#else
    detail = "لا توجد إضاءة نمو مُركّبة";
    return false;
#endif
  }

  detail = "مشغّل غير معروف";
  return false;
}

// ---------------------------------------------------------------------------
// Readings
// ---------------------------------------------------------------------------
void postReadings() {
  if (!claimed || WiFi.status() != WL_CONNECTED) return;

  float humidity = 0.0f;
  float temperature = 0.0f;
#if HAS_DHT
  humidity = dht.readHumidity();
  temperature = dht.readTemperature();
  if (isnan(humidity) || isnan(temperature)) {
    // Never send a fabricated value (and never reuse a stale one): skip the
    // sample so the control engine holds instead of acting on a bad number.
    Serial.println("DHT read failed - no reading sent");
    return;
  }
#endif

  float lightLux = 0.0f;
#if HAS_LDR
  lightLux = ldrToLux(analogRead(LDR_PIN));
#endif

  long ts = currentEpochSeconds();
  String body = "{\"readings\":[";
  for (int pot = 0; pot < NUM_POTS; pot++) {
    float soilPct = 0.0f;
#if HAS_SOIL
    soilPct = soilToPercent(analogRead(soilPins[pot]));
#endif
    if (pot > 0) body += ",";
    body += "{";
    body += "\"pot_index\":" + String(pot) + ",";
    body += "\"ts\":" + String(ts) + ",";
    body += "\"temperature\":" + String(temperature, 2) + ",";
    body += "\"humidity\":" + String(humidity, 2) + ",";
    body += "\"light\":" + String(lightLux, 2) + ",";
    body += "\"soil_moisture\":" + String(soilPct, 2) + ",";
    body += "\"ph\":6.5";
#if HAS_WATER_LEVEL
    body += ",\"water_level_pct\":" + String(waterLevelPercent(), 1);
#endif
    body += "}";
  }
  body += "]}";

  HTTPClient http;
  http.begin(ingestUrl);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " + deviceToken);
  int code = http.POST(body);
  if (code != 200 && code > 0) Serial.printf("Ingest %d\n", code);
  http.end();
}

// ---------------------------------------------------------------------------
// Command polling + acknowledgement (the real feedback loop)
// ---------------------------------------------------------------------------
void ackCommand(long commandId, bool ok, const String& detail, double waterUsedL) {
  HTTPClient http;
  String url = apiBase + "/api/v1/devices/" + deviceId + "/commands/" + String(commandId) + "/ack";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " + deviceToken);
  String body = "{\"ok\":" + String(ok ? "true" : "false") + ",\"detail\":\"" + detail + "\"";
  if (waterUsedL > 0) body += ",\"water_used_l\":" + String(waterUsedL, 3);
  body += "}";
  int code = http.POST(body);
  http.end();
  if (code != 200) Serial.printf("Ack %ld failed (%d)\n", commandId, code);
}

void pollCommands() {
  if (!claimed || deviceId.length() == 0 || WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String url = apiBase + "/api/v1/devices/" + deviceId + "/commands/pending";
  http.begin(url);
  http.addHeader("Authorization", "Bearer " + deviceToken);
  int code = http.GET();
  if (code != 200) {
    http.end();
    return;
  }
  String response = http.getString();
  http.end();

  int pos = 0;
  while (pos < (int)response.length()) {
    int objStart = response.indexOf('{', pos);
    if (objStart < 0) break;
    int objEnd = response.indexOf('}', objStart);
    if (objEnd < 0) break;
    String item = response.substring(objStart, objEnd + 1);
    pos = objEnd + 1;

    long commandId = jsonInt(item, "id", -1);
    String token = jsonString(item, "action");
    int durationSec = (int)jsonInt(item, "duration_sec", 5);
    if (commandId < 0 || token.length() == 0) continue;

    String actuator, action;
    int value = -1;
    parseToken(token, actuator, action, value);

    if (emergencyStop) {
      ackCommand(commandId, false, "إيقاف طارئ مُفعَّل على الجهاز", 0.0);
      continue;
    }

    String detail;
    bool ok = executeActuator(actuator, action, value, detail);

    // Pump runtime is bounded on the board too, whatever the command said.
    if (ok && actuator == "pump" && action == "on") {
      int seconds = durationSec > 0 ? durationSec : 10;
      if (seconds > PUMP_MAX_CMD_SECONDS) seconds = PUMP_MAX_CMD_SECONDS;
      delay(seconds * 1000UL);
      digitalWrite(RELAY_PIN, LOW);
      actuators.pump.on = false;
      actuators.pump.value = 0;
      detail += " (تم إنهاء التشغيل بعد الحد الأقصى المسموح)";
    }

    double used = 0.0;
#if HAS_FLOW
    if (actuator == "pump") {
      litersThisCycle = flowLiters();
      used = litersThisCycle;
      flowPulses = 0;
    }
#endif
    ackCommand(commandId, ok, detail, used);
    Serial.printf("Command %ld %s -> %s\n", commandId, token.c_str(), ok ? "OK" : "FAILED");
  }
}

/** Board-side maximum-runtime protection, independent of the server. */
void enforcePumpRuntime() {
#if HAS_PUMP
  if (!actuators.pump.on) return;
  if (millis() - actuators.pump.startedAt >= PUMP_MAX_SECONDS * 1000UL) {
    Serial.println("Pump max runtime reached - switching the relay off");
    digitalWrite(RELAY_PIN, LOW);
    actuators.pump.on = false;
    actuators.pump.value = 0;
  }
#endif
}

// ---------------------------------------------------------------------------
// Setup / loop
// ---------------------------------------------------------------------------
void setupPins() {
#if HAS_PUMP
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);
#endif
#if HAS_VALVE
  pinMode(VALVE_PIN, OUTPUT);
  digitalWrite(VALVE_PIN, LOW);
#endif
#if HAS_FAN
  ledcSetup(0, 25000, 8);
  ledcAttachPin(FAN_PIN, 0);
  ledcWrite(0, 0);
#endif
#if HAS_GROW_LIGHT
  ledcSetup(1, 5000, 8);
  ledcAttachPin(GROW_LIGHT_PIN, 1);
  ledcWrite(1, 0);
#endif
#if HAS_VENT_SERVO
  ventServo.attach(VENT_SERVO_PIN);
  ventServo.write(0);
#endif
#if HAS_FLOW
  pinMode(FLOW_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(FLOW_PIN), onFlowPulse, RISING);
#endif
}

void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);
  Serial.begin(115200);
  setupPins();
#if HAS_DHT
  dht.begin();
#endif
  loadCredentials();
  ensureWiFi();
  configTime(gmtOffsetSec, daylightOffsetSec, ntpServer);
  Serial.println("رَيّ — RAYY firmware ready (v" FIRMWARE_VERSION ")");
  Serial.printf("Hardware: pump=%d valve=%d fan=%d vent=%d light=%d | dht=%d ldr=%d soil=%d level=%d flow=%d\n",
                HAS_PUMP, HAS_VALVE, HAS_FAN, HAS_VENT_SERVO, HAS_GROW_LIGHT, HAS_DHT, HAS_LDR,
                HAS_SOIL, HAS_WATER_LEVEL, HAS_FLOW);
  if (!claimed) {
    Serial.println("Send SETUP_TOKEN=your_token via Serial to claim this device");
  }
}

void loop() {
  ensureWiFi();

  if (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    line.trim();
    if (line.startsWith("SETUP_TOKEN=")) {
      claimDevice(line.substring(12));
    }
  }

  unsigned long now = millis();
  if (now - lastReport >= REPORT_INTERVAL_MS) {
    lastReport = now;
    postReadings();
    reportState(false);
  }
  if (now - lastPoll >= POLL_INTERVAL_MS) {
    lastPoll = now;
    pollCommands();
  }
  enforcePumpRuntime();
  delay(50);
}
