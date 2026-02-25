import type { ResolvedEntity } from "../../../utils/supabaseClient";

type Props = {
  entities: ResolvedEntity[];
  onToggle: (entity: ResolvedEntity) => void;
  selectedKeys: Set<string>;
};

function entityKey(e: ResolvedEntity) {
  return `${e.type}:${e.id || e.name}`;
}

export default function EntityResolutionPanel({ entities, onToggle, selectedKeys }: Props) {
  if (!entities.length) {
    return (
      <div className="rounded-lg border bg-white p-4 text-sm text-gray-600">
        No matching team/department/shift entities detected from instruction yet.
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-white">
      <div className="border-b px-4 py-3">
        <h4 className="text-sm font-semibold text-gray-900">Entity Resolution</h4>
        <p className="text-xs text-gray-600">Confirm scope so AI applies policy to the correct people.</p>
      </div>
      <div className="divide-y">
        {entities.map((e) => {
          const key = entityKey(e);
          const checked = selectedKeys.has(key);
          return (
            <label key={key} className="flex items-center justify-between px-4 py-2 text-sm">
              <div>
                <div className="font-medium text-gray-900">
                  {e.name}{" "}
                  <span className="ml-2 rounded bg-gray-100 px-2 py-0.5 text-xs uppercase text-gray-600">
                    {e.type}
                  </span>
                </div>
                <div className="text-xs text-gray-500">Confidence: {(e.confidence * 100).toFixed(0)}%</div>
              </div>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(e)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
            </label>
          );
        })}
      </div>
    </div>
  );
}
