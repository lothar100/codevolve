interface DashboardErrorStateProps {
  title: string;
}

export function DashboardErrorState({
  title,
}: DashboardErrorStateProps) {
  return (
    <div className="dashboard-error-state" role="status" aria-label={`${title} unavailable`}>
      <div className="dashboard-error-state__title">
        {title} is taking a little nap.
      </div>
      <div className="dashboard-error-state__body">
        The charts will be back soon.
      </div>
    </div>
  );
}
