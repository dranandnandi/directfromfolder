import React, { createContext, useEffect, useMemo, useState } from "react";
import { Routes, Route, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useOrganization } from "../contexts/OrganizationContext";
import PayrollAdminHome from "./PayrollAdminHome";
import PayrollPeriodBoard from "./PayrollPeriodBoard";
import StatutoryCenter from "./StatutoryCenter";
import PayrollSettings from "./PayrollSettings";
import UploadAndMap from "./AttendanceImportWizard/UploadAndMap";
import ReviewValidate from "./AttendanceImportWizard/ReviewValidate";
import ApplyOverrides from "./AttendanceImportWizard/ApplyOverrides";
import CompensationEditor from "./CompensationEditor";

/** =======================
 *  Context (exact values used across the module)
 *  ======================= */
export type PayrollCtx = {
  orgId: string;
  month: number;
  year: number;
  setOrgId: (id: string) => void;
  setMonth: (m: number) => void;
  setYear: (y: number) => void;
};

export const PayrollContext = createContext<PayrollCtx>({
  orgId: "",
  month: 9, // Default to September
  year: 2025, // Default to 2025
  setOrgId: () => {},
  setMonth: () => {},
  setYear: () => {},
});

/** =======================
 *  Shell Layout
 *  ======================= */

function useQueryParams() {
  const { search } = useLocation();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  return params;
}

function stripToInt(v: any, fallback: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.floor(n));
}

function Header({
  month,
  setMonth,
  year,
  setYear,
}: {
  month: number;
  setMonth: (m: number) => void;
  year: number;
  setYear: (y: number) => void;
}) {
  return (
    <header className="border-b bg-white">
      <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <div className="text-lg font-semibold text-gray-900">Payroll</div>
          <nav className="flex items-center gap-2 text-sm">
            <Tab to="/payroll">Dashboard</Tab>
            <Tab to="/payroll/period-board">Period Board</Tab>
            <Tab to="/payroll/statutory">Statutory</Tab>
            <Tab to="/payroll/settings">Settings</Tab>
            <Tab to="/payroll/import/upload">Upload</Tab>
            <Tab to="/payroll/import/review">Review</Tab>
            <Tab to="/payroll/import/overrides">Overrides</Tab>
            <Tab to="/payroll/compensation">Comp Editor</Tab>
          </nav>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            title="Month"
          >
            {[
              { value: 1, label: '01 - January' },
              { value: 2, label: '02 - February' },
              { value: 3, label: '03 - March' },
              { value: 4, label: '04 - April' },
              { value: 5, label: '05 - May' },
              { value: 6, label: '06 - June' },
              { value: 7, label: '07 - July' },
              { value: 8, label: '08 - August' },
              { value: 9, label: '09 - September' },
              { value: 10, label: '10 - October' },
              { value: 11, label: '11 - November' },
              { value: 12, label: '12 - December' }
            ].map((month) => (
              <option key={month.value} value={month.value}>
                {month.label}
              </option>
            ))}
          </select>

          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            title="Year"
          >
            <option value={2025}>2025</option>
          </select>
        </div>
      </div>
    </header>
  );
}

function Tab({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `px-2 py-1 rounded-md ${isActive ? "bg-blue-600 text-white" : "text-gray-700 hover:bg-gray-100"}`
      }
      end
    >
      {children}
    </NavLink>
  );
}

/** =======================
 *  Inner shell (reads/writes URL, fetches orgs, provides context)
 *  ======================= */
function InnerShell() {
  const navigate = useNavigate();
  const params = useQueryParams();
  const { organizationId } = useOrganization();

  // derive initial period from URL or default to September 2025
  const initialMonth = stripToInt(params.get("month"), 9); // Default to September
  const initialYear = 2025; // Always use 2025

  const [month, setMonth] = useState(initialMonth);
  const [year, setYear] = useState(initialYear);

  // sync state changes back to URL (with guards to prevent loops)
  useEffect(() => {
    const currentMonth = stripToInt(params.get("month"), 9); // Default to September
    const currentYear = 2025; // Always use 2025
    
    // Only navigate if the URL parameters differ from current state
    if (month !== currentMonth || year !== currentYear) {
      const newParams = new URLSearchParams();
      newParams.set("month", month.toString());
      newParams.set("year", year.toString());
      
      navigate(`?${newParams.toString()}`, { replace: true });
    }
  }, [month, year, navigate, params]);

  const ctxValue = useMemo<PayrollCtx>(
    () => ({ 
      orgId: organizationId, 
      month, 
      year, 
      setOrgId: () => {}, // No-op since orgId is fixed from context
      setMonth, 
      setYear 
    }),
    [organizationId, month, year]
  );

  return (
    <PayrollContext.Provider value={ctxValue}>
      <Header
        month={month}
        setMonth={setMonth}
        year={year}
        setYear={setYear}
      />
      <main className="max-w-7xl mx-auto px-4 py-6">
        <Routes>
          <Route path="/" element={<PayrollAdminHome />} />
          <Route path="/period-board" element={<PayrollPeriodBoard />} />
          <Route path="/statutory" element={<StatutoryCenter />} />
          <Route path="/settings" element={<PayrollSettings />} />
          <Route path="/import/upload" element={<UploadAndMap />} />
          <Route path="/import/review" element={<ReviewValidate />} />
          <Route path="/import/overrides" element={<ApplyOverrides />} />
          <Route path="/compensation" element={<CompensationEditor />} />
          {/* default fallback to dashboard */}
          <Route path="*" element={<PayrollAdminHome />} />
        </Routes>
      </main>
    </PayrollContext.Provider>
  );
}

/** =======================
 *  Public export
 *  ======================= */
export default function PayrollShell() {
  return <InnerShell />;
}
