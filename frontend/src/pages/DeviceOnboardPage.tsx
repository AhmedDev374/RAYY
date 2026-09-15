import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';

interface RegisterResponse {
  device_id: number;
  setup_token: string;
  qr_payload: string;
  claim_url: string;
}

export default function DeviceOnboardPage() {
  const [reg, setReg] = useState<RegisterResponse | null>(null);

  const register = useMutation({
    mutationFn: () =>
      api<RegisterResponse>('/api/v1/devices/register?name=ESP32', { method: 'POST' }),
    onSuccess: setReg,
  });

  return (
    <div dir="rtl" lang="ar" className="font-arabic">
      <h1 className="text-2xl font-bold text-leaf-800 mb-6">تهيئة الجهاز</h1>
      <div className="bg-white rounded-xl shadow p-6 max-w-lg">
        <p className="text-sm text-gray-600 mb-4">
          سجّل جهاز استشعار ESP32 جديد. ثبّت البرنامج الثابت المحدّث، ثم استخدم رمز الإعداد
          أدناه في خطوة ربط الجهاز.
        </p>
        <button
          onClick={() => register.mutate()}
          disabled={register.isPending}
          className="bg-leaf-700 text-white px-4 py-2 rounded"
        >
          تسجيل جهاز جديد
        </button>

        {reg && (
          <div className="mt-6 space-y-3 text-sm">
            <p><strong>معرّف الجهاز:</strong> {reg.device_id}</p>
            <p><strong>رمز الإعداد:</strong></p>
            <code dir="ltr" className="block bg-gray-100 p-2 rounded break-all">{reg.setup_token}</code>
            <p><strong>رابط الربط:</strong> {reg.claim_url}</p>
            <p><strong>بيانات رمز QR:</strong></p>
            <code dir="ltr" className="block bg-gray-100 p-2 rounded break-all text-xs">{reg.qr_payload}</code>
            <p className="text-gray-500 mt-2">
              سيرسل جهاز ESP32 طلب POST إلى <code dir="ltr">/api/v1/devices/claim</code> مع هذا الرمز،
              ثم يخزّن رمز الجهاز المُعاد في ذاكرة NVS.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
