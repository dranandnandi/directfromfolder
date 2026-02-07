

export type StatusType = "draft" | "pending" | "processed" | "finalized" | "locked" | "posted" | "paid" | "generated" | "filed" | "absent" | "active" | "inactive";

interface StatusBadgeProps {
    status: string;
    type?: StatusType; // Optional mapping helper
    size?: "sm" | "md";
}

export function StatusBadge({ status, type, size = "md" }: StatusBadgeProps) {
    // Normalize status for styling if type not provided
    const normalized = type || status.toLowerCase() as StatusType;

    const styles: Record<string, string> = {
        draft: "bg-gray-100 text-gray-700 border-gray-200",
        pending: "bg-yellow-50 text-yellow-700 border-yellow-200",
        processed: "bg-blue-50 text-blue-700 border-blue-200",
        finalized: "bg-purple-50 text-purple-700 border-purple-200",
        locked: "bg-indigo-50 text-indigo-700 border-indigo-200",
        posted: "bg-green-50 text-green-700 border-green-200",
        paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
        generated: "bg-cyan-50 text-cyan-700 border-cyan-200",
        filed: "bg-teal-50 text-teal-700 border-teal-200",
        absent: "bg-red-50 text-red-700 border-red-200",
        active: "bg-green-50 text-green-700 border-green-200",
        inactive: "bg-gray-100 text-gray-500 border-gray-200",
    };

    const defaultStyle = "bg-gray-100 text-gray-700 border-gray-200";
    const styleClass = styles[normalized] || defaultStyle;
    const sizeClass = size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs";

    return (
        <span className={`inline-flex items-center justify-center rounded-full border font-medium capitalize ${styleClass} ${sizeClass}`}>
            {status}
        </span>
    );
}
