import React from "react";

interface Column<T> {
    header: string;
    accessorKey?: keyof T;
    cell?: (item: T) => React.ReactNode;
    className?: string;
    align?: "left" | "center" | "right";
}

interface DataTableProps<T> {
    data: T[];
    columns: Column<T>[];
    keyExtractor: (item: T) => string;
    onRowClick?: (item: T) => void;
    emptyMessage?: string;
    loading?: boolean;
}

export function DataTable<T>({
    data,
    columns,
    keyExtractor,
    onRowClick,
    emptyMessage = "No data available",
    loading = false
}: DataTableProps<T>) {

    if (loading) {
        return (
            <div className="w-full h-64 flex items-center justify-center bg-white rounded-lg border border-gray-200">
                <div className="animate-pulse flex flex-col items-center">
                    <div className="h-4 w-32 bg-gray-200 rounded mb-2"></div>
                    <div className="h-3 w-24 bg-gray-100 rounded"></div>
                </div>
            </div>
        );
    }

    if (data.length === 0) {
        return (
            <div className="w-full py-12 flex flex-col items-center justify-center bg-white rounded-lg border border-gray-200 text-center">
                <p className="text-gray-500 font-medium">{emptyMessage}</p>
            </div>
        );
    }

    return (
        <div className="w-full overflow-hidden bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            {columns.map((col, idx) => (
                                <th
                                    key={idx}
                                    scope="col"
                                    className={`px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider ${col.align === 'right' ? 'text-right' :
                                            col.align === 'center' ? 'text-center' : 'text-left'
                                        } ${col.className || ''}`}
                                >
                                    {col.header}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {data.map((item) => (
                            <tr
                                key={keyExtractor(item)}
                                onClick={() => onRowClick && onRowClick(item)}
                                className={`transition-colors ${onRowClick ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                            >
                                {columns.map((col, idx) => (
                                    <td
                                        key={idx}
                                        className={`px-6 py-4 whitespace-nowrap text-sm text-gray-900 ${col.align === 'right' ? 'text-right' :
                                                col.align === 'center' ? 'text-center' : 'text-left'
                                            }`}
                                    >
                                        {col.cell ? col.cell(item) : (col.accessorKey ? String(item[col.accessorKey]) : null)}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
