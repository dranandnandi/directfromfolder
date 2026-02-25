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
import PayrollPreview from "./PayrollPreview";
import AIAttendanceConfigurator from "../components/hr/AIAttendanceConfigurator";
import AIAttendanceReviewQueue from "../components/hr/AIAttendanceReviewQueue";

/** =======================
 *  Context
 *  ======================= */
export type PayrollCtx = {
  orgId: string;
  month: number;
  year: number;
  setOrgId: (id: string) => void;
  setMonth: (m: number) => void;
  setYear: (y: number) => void;
};

const DEFAULT_DATE = new Date();
const DEFAULT_MONTH = DEFAULT_DATE.getMonth() + 1;
const DEFAULT_YEAR = DEFAULT_DATE.getFullYear();

export const PayrollContext = createContext<PayrollCtx>({
  orgId: "",
  month: DEFAULT_MONTH,
  year: DEFAULT_YEAR,
  setOrgId: () => { },
  setMonth: () => { },
  setYear: () => { },
});

/** =======================
 *  Helpers
 *  ======================= */
function useQueryParams() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

function stripToInt(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : fallback;
}

function clampYear(v: any, fallback: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const year = Math.floor(n);
  return year >= 2000 && year <= 2100 ? year : fallback;
}

/** =======================
 *  Components
 *  ======================= */
function NavTab({ to, label, icon }: { to: string; label: string; icon?: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end={to === "/payroll"} // Only exact match for root
      className={({ isActive }) =>
        `flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${isActive
          ? "bg-blue-50 text-blue-700"
          : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
        }`
      }
    >
      {icon}
      {label}
    </NavLink>
  );
}

function MonthSelector({ month, setMonth }: { month: number; setMonth: (m: number) => void }) {
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  return (
    <select
      value={month}
      onChange={(e) => setMonth(Number(e.target.value))}
      className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
    >
      {months.map((m, i) => (
        <option key={i + 1} value={i + 1}>
          {i + 1 < 10 ? `0${i + 1}` : i + 1} - {m}
        </option>
      ))}
    </select>
  );
}

function YearSelector({ year, setYear }: { year: number; setYear: (y: number) => void }) {
  const years: number[] = [];
  const startYear = DEFAULT_YEAR - 5;
  const endYear = DEFAULT_YEAR + 5;

  for (let y = startYear; y <= endYear; y += 1) {
    years.push(y);
  }

  return (
    <select
      value={year}
      onChange={(e) => setYear(Number(e.target.value))}
      className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
    >
      {years.map((y) => (
        <option key={y} value={y}>{y}</option>
      ))}
    </select>
  );
}

/** =======================
 *  Shell Layout
 *  ======================= */
function InnerShell() {
  const navigate = useNavigate();
  const params = useQueryParams();
  const { organizationId } = useOrganization();

  // State
  const initialMonth = stripToInt(params.get("month"), DEFAULT_MONTH);
  const initialYear = clampYear(params.get("year"), DEFAULT_YEAR);
  const [month, setMonth] = useState(initialMonth);
  const [year, setYear] = useState(initialYear);

  // Sync URL
  useEffect(() => {
    const currentMonth = stripToInt(params.get("month"), DEFAULT_MONTH);
    const currentYear = clampYear(params.get("year"), DEFAULT_YEAR);

    if (month !== currentMonth || year !== currentYear) {
      const newParams = new URLSearchParams();
      newParams.set("month", month.toString());
      newParams.set("year", year.toString());
      navigate(`?${newParams.toString()}`, { replace: true });
    }
  }, [month, year, navigate, params]);

  const ctxValue = useMemo<PayrollCtx>(() => ({
    orgId: organizationId,
    month,
    year,
    setOrgId: () => { },
    setMonth,
    setYear
  }), [organizationId, month, year]);

  return (
    <PayrollContext.Provider value={ctxValue}>
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {/* Top Navigation Bar */}
        <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between h-16">
              <div className="flex">
                <div className="flex-shrink-0 flex items-center">
                  <span className="text-xl font-bold text-gray-900">Payroll</span>
                </div>
                <nav className="hidden sm:ml-6 sm:flex sm:space-x-2 items-center">
                  <NavTab to="/payroll" label="Dashboard" />
                  <NavTab to="/payroll/period-board" label="Run Payroll" />
                  <NavTab to="/payroll/compensation" label="Compensation" />
                  <NavTab to="/payroll/attendance-intelligence" label="Attendance AI" />
                  <NavTab to="/payroll/ai-review" label="AI Review" />
                  <NavTab to="/payroll/statutory" label="Statutory" />
                  <NavTab to="/payroll/settings" label="Settings" />
                </nav>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-44">
                  <MonthSelector month={month} setMonth={setMonth} />
                </div>
                <div className="w-32">
                  <YearSelector year={year} setYear={setYear} />
                </div>
              </div>
            </div>
          </div>

          {/* Secondary Nav for Sub-sections (Import Wizard) */}
          <div className="bg-gray-50 border-b border-gray-200">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <Routes>
                <Route path="/import/*" element={
                  <nav className="flex space-x-4 py-2">
                    <NavTab to="/payroll/import/upload" label="1. Upload" />
                    <NavTab to="/payroll/import/review" label="2. Review" />
                    <NavTab to="/payroll/import/overrides" label="3. Overrides" />
                  </nav>
                } />
                <Route path="*" element={null} />
              </Routes>
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Routes>
            <Route path="/" element={<PayrollAdminHome />} />
            <Route path="/preview" element={<PayrollPreview />} />
            <Route path="/period-board" element={<PayrollPeriodBoard />} />
            <Route path="/statutory" element={<StatutoryCenter />} />
            <Route path="/settings" element={<PayrollSettings />} />
            <Route path="/import/upload" element={<UploadAndMap />} />
            <Route path="/import/review" element={<ReviewValidate />} />
            <Route path="/import/overrides" element={<ApplyOverrides />} />
            <Route path="/compensation" element={<CompensationEditor />} />
            <Route path="/attendance-intelligence" element={<AIAttendanceConfigurator />} />
            <Route path="/ai-review" element={<AIAttendanceReviewQueue />} />
            <Route path="*" element={<PayrollAdminHome />} />
          </Routes>
        </main>
      </div>
    </PayrollContext.Provider>
  );
}

export default function PayrollShell() {
  return <InnerShell />;
}
