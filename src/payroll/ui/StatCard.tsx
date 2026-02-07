import React from "react";

interface StatCardProps {
    label: string;
    value: string | number;
    sub?: string;
    trend?: "up" | "down" | "neutral";
    trendValue?: string;
    icon?: React.ReactNode;
    onClick?: () => void;
}

export function StatCard({ label, value, sub, trend, trendValue, icon, onClick }: StatCardProps) {
    return (
        <div
            className={`bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-shadow ${onClick ? 'cursor-pointer' : ''}`}
            onClick={onClick}
        >
            <div className="flex justify-between items-start">
                <div>
                    <p className="text-sm font-medium text-gray-500">{label}</p>
                    <h3 className="text-2xl font-bold text-gray-900 mt-1">{value}</h3>
                </div>
                {icon && (
                    <div className="p-2 bg-gray-50 rounded-lg text-gray-600">
                        {icon}
                    </div>
                )}
            </div>

            {(sub || trend) && (
                <div className="mt-3 flex items-center text-xs">
                    {trend && (
                        <span className={`flex items-center font-medium mr-2 ${trend === 'up' ? 'text-green-600' :
                                trend === 'down' ? 'text-red-600' : 'text-gray-600'
                            }`}>
                            {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '•'} {trendValue}
                        </span>
                    )}
                    {sub && <span className="text-gray-500">{sub}</span>}
                </div>
            )}
        </div>
    );
}
