import { Link } from "react-router-dom";
import { HiClock, HiCog, HiExclamationCircle } from "react-icons/hi";

const Card = ({
  to,
  title,
  description,
  icon: Icon,
}: {
  to: string;
  title: string;
  description: string;
  icon: any;
}) => (
  <Link to={to} className="block rounded-lg border bg-white p-4 shadow-sm hover:bg-gray-50">
    <div className="flex items-start gap-3">
      <div className="rounded-md bg-blue-100 p-2">
        <Icon className="h-5 w-5 text-blue-700" />
      </div>
      <div>
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        <p className="text-sm text-gray-600">{description}</p>
        <p className="mt-2 text-xs text-blue-700">{to}</p>
      </div>
    </div>
  </Link>
);

export default function AIAttendanceCenter() {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-white p-6">
        <h2 className="text-2xl font-semibold text-gray-900">AI Attendance Control Center</h2>
        <p className="mt-1 text-sm text-gray-600">
          One place to access attendance operations, AI shift configuration, and review workflow.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card
          to="/attendance"
          title="Attendance Dashboard"
          description="Daily attendance status, regularization, and AI status strip."
          icon={HiClock}
        />
        <Card
          to="/attendance/ai-configurator"
          title="AI Shift Configurator"
          description="Voice/text instruction to policy JSON with approval flow."
          icon={HiCog}
        />
        <Card
          to="/attendance/ai-review"
          title="AI Review Queue"
          description="Approve/reject low-confidence AI decisions."
          icon={HiExclamationCircle}
        />
      </div>
    </div>
  );
}
