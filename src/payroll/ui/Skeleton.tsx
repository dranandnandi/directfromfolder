export function Line({ w = "100%" }: { w?: string }) {
  return <div className="animate-pulse h-4 rounded bg-gray-200" style={{ width: w }} />;
}

export function CardRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="p-4 border rounded bg-white">
          <div className="flex gap-4">
            <Line w="30%" />
            <Line w="20%" />
            <Line w="15%" />
          </div>
        </div>
      ))}
    </div>
  );
}
