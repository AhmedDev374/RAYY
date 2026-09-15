import { useEffect, useRef, useState } from 'react';
import { getAccessToken } from '../lib/api';

const API_URL = import.meta.env.VITE_API_URL || '';

export interface Reading {
  id: number;
  plant_id: number;
  pot_index: number;
  ts: number;
  temperature: number;
  humidity: number;
  light: number;
  soil_moisture: number;
  ph: number;
}

export function usePlantWebSocket(plantId: number | null) {
  const [reading, setReading] = useState<Reading | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    // Selecting a different plant must never keep the previous plant's reading
    // on screen. React keeps this state across renders, and the cleanup below
    // only closed the socket -- so without this reset `reading` still held the
    // old plant's last payload and the dashboard showed the wrong plant's data.
    setReading(null);
    setConnected(false);

    if (!plantId) return;

    let cancelled = false;

    (async () => {
      const token = await getAccessToken();
      if (!token || cancelled) return;

      const wsUrl = API_URL.replace(/^http/, 'ws');
      const ws = new WebSocket(
        `${wsUrl}/api/v1/ws/plants/${plantId}?token=${encodeURIComponent(token)}`,
      );
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onclose = () => setConnected(false);
      ws.onmessage = (ev) => {
        try {
          setReading(JSON.parse(ev.data));
        } catch {
          /* ignore */
        }
      };
    })();

    return () => {
      cancelled = true;
      wsRef.current?.close();
    };
  }, [plantId]);

  return { reading, connected };
}
