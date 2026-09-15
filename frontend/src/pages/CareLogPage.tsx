import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';

const EVENT_TYPES = ['water', 'fertilize', 'prune', 'repot', 'note'];
// Display-only Arabic labels. The API payload keeps the English `event_type`.
const EVENT_LABELS: Record<string, string> = {
  water: 'ري',
  fertilize: 'تسميد',
  prune: 'تقليم',
  repot: 'إعادة زراعة',
  note: 'ملاحظة',
};

interface CareEvent {
  id: number;
  event_type: string;
  notes: string | null;
  created_at: string;
}

export default function CareLogPage() {
  const { plantId } = useParams<{ plantId: string }>();
  const id = Number(plantId);
  const qc = useQueryClient();

  const { data: events = [] } = useQuery({
    queryKey: ['care', id],
    queryFn: () => api<CareEvent[]>(`/api/v1/plants/${id}/care-events`),
    enabled: !!id,
  });

  const add = useMutation({
    mutationFn: (body: { event_type: string; notes?: string }) =>
      api(`/api/v1/plants/${id}/care-events`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['care', id] }),
  });

  return (
    <div dir="rtl" lang="ar" className="font-arabic">
      <h1 className="text-2xl font-bold text-leaf-800 mb-6">سجل العناية</h1>
      <div className="flex flex-wrap gap-2 mb-6">
        {EVENT_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => add.mutate({ event_type: t })}
            className="bg-leaf-700 text-white px-3 py-1 rounded text-sm"
          >
            {EVENT_LABELS[t] ? `تسجيل ${EVENT_LABELS[t]}` : t}
          </button>
        ))}
      </div>
      <ul className="space-y-3">
        {events.map((e) => (
          <li key={e.id} className="bg-white rounded-lg shadow p-4 flex justify-between">
            <span className="font-medium">{EVENT_LABELS[e.event_type] ?? e.event_type}</span>
            <span className="text-gray-500 text-sm">{new Date(e.created_at).toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
