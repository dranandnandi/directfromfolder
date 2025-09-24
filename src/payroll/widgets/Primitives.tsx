import React from 'react';

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-5">
      <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
      {subtitle && <p className="text-gray-500 mt-1">{subtitle}</p>}
    </div>
  );
}

export function StatCard({ label, value, tone = 'default' }: { label: string; value: React.ReactNode; tone?: 'default' | 'success' | 'warn' }) {
  const toneCls =
    tone === 'success' ? 'bg-green-50 border-green-200' : tone === 'warn' ? 'bg-amber-50 border-amber-200' : 'bg-blue-50 border-blue-200';
  return (
    <div className={`border ${toneCls} rounded p-4`}>
      <div className="text-sm text-gray-600">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="border rounded p-6 text-center text-gray-600 bg-white">
      <div className="text-lg font-medium text-gray-800">{title}</div>
      {description && <p className="mt-1">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function AsyncSection({
  loading,
  error,
  children,
}: {
  loading: boolean;
  error: string | null;
  children: React.ReactNode;
}) {
  // Prefer pleasant skeletons and a consistent error banner
  if (loading) {
    try {
      const { CardRows } = require('../ui/Skeleton');
      return <CardRows rows={3} />;
    } catch {
      return <div className="animate-pulse text-gray-500">Loading…</div>;
    }
  }
  if (error) {
    try {
      const ErrorBanner = require('../ui/ErrorBanner').default;
      return <ErrorBanner message={error} />;
    } catch {
      return <div className="text-red-600">Error: {error}</div>;
    }
  }
  return <>{children}</>;
}
