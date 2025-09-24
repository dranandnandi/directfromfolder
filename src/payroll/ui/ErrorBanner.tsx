export default function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded">
      {message}
    </div>
  );
}
