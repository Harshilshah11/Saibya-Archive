export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-48 animate-pulse rounded bg-panel-2" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg bg-panel-2" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-lg bg-panel-2" />
    </div>
  );
}
