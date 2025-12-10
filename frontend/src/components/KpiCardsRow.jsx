import { 
  Cpu, 
  CheckCircle, 
  ThumbsUp, 
  AlertTriangle, 
  XCircle,
  TrendingUp,
  TrendingDown,
  Loader2
} from 'lucide-react';
import './KpiCardsRow.css';

const KpiCard = ({ title, value, icon: Icon, color, trend, trendValue }) => {
  return (
    <div className={`kpi-card kpi-${color}`}>
      <div className="kpi-card-header">
        <div className={`kpi-icon-wrapper kpi-icon-${color}`}>
          <Icon size={24} />
        </div>
        {trend && (
          <div className={`kpi-trend ${trend === 'up' ? 'trend-up' : 'trend-down'}`}>
            {trend === 'up' ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            <span>{trendValue}</span>
          </div>
        )}
      </div>
      <div className="kpi-card-body">
        <span className="kpi-value">{value.toLocaleString()}</span>
        <span className="kpi-label">{title}</span>
      </div>
      <div className={`kpi-card-accent kpi-accent-${color}`}></div>
    </div>
  );
};

const KpiCardsRow = ({ data = {}, loading = false, error = null }) => {
  // Default values for when data is empty or undefined
  const kpiData = {
    totalMachines: data.totalMachines ?? 0,
    normal: data.normal ?? 0,
    satisfactory: data.satisfactory ?? 0,
    alert: data.alert ?? 0,
    unacceptable: data.unacceptable ?? 0,
    // Optional trend data from backend
    trends: data.trends || {}
  };

  const cards = [
    {
      title: 'Total Machines',
      value: kpiData.totalMachines,
      icon: Cpu,
      color: 'total',
      trend: kpiData.trends.totalMachines?.direction || null,
      trendValue: kpiData.trends.totalMachines?.value || ''
    },
    {
      title: 'Normal',
      value: kpiData.normal,
      icon: CheckCircle,
      color: 'normal',
      trend: kpiData.trends.normal?.direction || null,
      trendValue: kpiData.trends.normal?.value || ''
    },
    {
      title: 'Satisfactory',
      value: kpiData.satisfactory,
      icon: ThumbsUp,
      color: 'satisfactory',
      trend: kpiData.trends.satisfactory?.direction || null,
      trendValue: kpiData.trends.satisfactory?.value || ''
    },
    {
      title: 'Alert',
      value: kpiData.alert,
      icon: AlertTriangle,
      color: 'alert',
      trend: kpiData.trends.alert?.direction || null,
      trendValue: kpiData.trends.alert?.value || ''
    },
    {
      title: 'Unacceptable',
      value: kpiData.unacceptable,
      icon: XCircle,
      color: 'unacceptable',
      trend: kpiData.trends.unacceptable?.direction || null,
      trendValue: kpiData.trends.unacceptable?.value || ''
    }
  ];

  if (loading) {
    return (
      <div className="kpi-cards-row kpi-loading">
        <div className="kpi-loading-indicator">
          <Loader2 size={24} className="spinning" />
          <span>Loading KPI data...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="kpi-cards-row kpi-error">
        <div className="kpi-error-message">
          <AlertTriangle size={20} />
          <span>Failed to load KPI data: {error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="kpi-cards-row">
      {cards.map((card, index) => (
        <KpiCard key={index} {...card} />
      ))}
    </div>
  );
};

export default KpiCardsRow;
