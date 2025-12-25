import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  AreaChart
} from 'recharts';
import { TrendingUp, Users, Loader2, AlertTriangle, BarChart3 } from 'lucide-react';
import './ChartsSection.css';

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="custom-tooltip">
        <p className="tooltip-label">{label}</p>
        {payload.map((entry, index) => (
          <p key={index} style={{ color: entry.color }} className="tooltip-value">
            {entry.name}: {entry.value.toLocaleString()}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

const LoadingState = ({ message = 'Loading...' }) => (
  <div className="chart-loading">
    <Loader2 size={24} className="spinning" />
    <span>{message}</span>
  </div>
);

const ErrorState = ({ message }) => (
  <div className="chart-error">
    <AlertTriangle size={20} />
    <span>{message}</span>
  </div>
);

const EmptyState = ({ message = 'No data available' }) => (
  <div className="chart-empty">
    <BarChart3 size={40} />
    <span>{message}</span>
  </div>
);

// Dynamic color palette for customers - vibrant, light colors
const CUSTOMER_COLORS = [
  '#3b82f6', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b',
  '#ef4444', '#ec4899', '#6366f1', '#14b8a6', '#f97316'
];

// Sanitize string to be a valid SVG ID (remove special chars, spaces, etc.)
const sanitizeId = (str) => {
  return str.replace(/[^a-zA-Z0-9]/g, '_');
};

const ChartsSection = ({
  customerTrendData = [],
  statusTrendData = [],
  loading = { customerTrend: false, statusTrend: false },
  errors = { customerTrend: null, statusTrend: null },
  onBarClick = null  // Handler for when a bar is clicked
}) => {
  const statusColors = {
    normal: '#10b981',
    satisfactory: '#06b6d4',
    alert: '#f59e0b',
    unacceptable: '#ef4444'
  };

  // Dynamically extract customer keys from data
  const customerKeys = useMemo(() => {
    if (!customerTrendData || customerTrendData.length === 0) return [];
    const keys = new Set();
    customerTrendData.forEach(item => {
      Object.keys(item).forEach(key => {
        if (key !== 'date') keys.add(key);
      });
    });
    return Array.from(keys);
  }, [customerTrendData]);

  // Generate gradient definitions dynamically with sanitized IDs
  const generateGradients = () => {
    return customerKeys.map((key, index) => {
      const color = CUSTOMER_COLORS[index % CUSTOMER_COLORS.length];
      const safeId = sanitizeId(key);
      return (
        <linearGradient key={safeId} id={`color${safeId}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor={color} stopOpacity={0.6} />
          <stop offset="95%" stopColor={color} stopOpacity={0.1} />
        </linearGradient>
      );
    });
  };

  return (
    <div className="charts-section">
      {/* Customer Trend Chart */}
      <div className="chart-card">
        <div className="chart-header">
          <div className="chart-title">
            <Users size={20} className="chart-icon" />
            <div>
              <h3>Customer Trends</h3>
              <p>Machine activity by customer over time</p>
            </div>
          </div>
        </div>
        <div className="chart-body">
          {loading.customerTrend ? (
            <LoadingState message="Loading customer trends..." />
          ) : errors.customerTrend ? (
            <ErrorState message={errors.customerTrend} />
          ) : customerTrendData.length === 0 ? (
            <EmptyState message="No customer trend data available" />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={customerTrendData}>
                <defs>
                  {generateGradients()}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#64748b', fontSize: 12 }}
                  axisLine={{ stroke: '#e2e8f0' }}
                />
                <YAxis
                  tick={{ fill: '#64748b', fontSize: 12 }}
                  axisLine={{ stroke: '#e2e8f0' }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  wrapperStyle={{ paddingTop: '20px' }}
                  layout="horizontal"
                  align="center"
                  verticalAlign="bottom"
                  iconType="circle"
                  iconSize={8}
                  formatter={(value) => {
                    // Truncate long customer IDs for display
                    const displayValue = value.length > 12 ? value.substring(0, 8) + '...' : value;
                    return <span style={{ color: '#64748b', fontSize: '11px', marginRight: '8px' }}>{displayValue}</span>;
                  }}
                />
                {customerKeys.map((key, index) => {
                  const color = CUSTOMER_COLORS[index % CUSTOMER_COLORS.length];
                  const safeId = sanitizeId(key);
                  return (
                    <Area
                      key={key}
                      type="monotone"
                      dataKey={key}
                      name={key}
                      stroke={color}
                      fillOpacity={1}
                      fill={`url(#color${safeId})`}
                      strokeWidth={2}
                    />
                  );
                })}
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Machine Status Trends Chart */}
      <div className="chart-card">
        <div className="chart-header">
          <div className="chart-title">
            <TrendingUp size={20} className="chart-icon" />
            <div>
              <h3>Machine Status Trends</h3>
              <p>Status distribution over time {onBarClick && <span className="click-hint">(Click bars to view details)</span>}</p>
            </div>
          </div>
        </div>
        <div className="chart-body">
          {loading.statusTrend ? (
            <LoadingState message="Loading status trends..." />
          ) : errors.statusTrend ? (
            <ErrorState message={errors.statusTrend} />
          ) : statusTrendData.length === 0 ? (
            <EmptyState message="No status trend data available" />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={statusTrendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#64748b', fontSize: 12 }}
                  axisLine={{ stroke: '#e2e8f0' }}
                />
                <YAxis
                  tick={{ fill: '#64748b', fontSize: 12 }}
                  axisLine={{ stroke: '#e2e8f0' }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  wrapperStyle={{ paddingTop: '20px' }}
                  formatter={(value) => <span style={{ color: '#64748b' }}>{value.charAt(0).toUpperCase() + value.slice(1)}</span>}
                />
                <Bar
                  dataKey="normal"
                  name="Normal"
                  stackId="status"
                  fill={statusColors.normal}
                  radius={[0, 0, 0, 0]}
                  cursor={onBarClick ? 'pointer' : 'default'}
                  onClick={(data, index, event) => {
                    if (onBarClick && data && data.date) {
                      console.log('Bar clicked - Normal:', data);
                      onBarClick(data.date, 'Normal');
                    }
                  }}
                />
                <Bar
                  dataKey="satisfactory"
                  name="Satisfactory"
                  stackId="status"
                  fill={statusColors.satisfactory}
                  cursor={onBarClick ? 'pointer' : 'default'}
                  onClick={(data, index, event) => {
                    if (onBarClick && data && data.date) {
                      console.log('Bar clicked - Satisfactory:', data);
                      onBarClick(data.date, 'Satisfactory');
                    }
                  }}
                />
                <Bar
                  dataKey="alert"
                  name="Alert"
                  stackId="status"
                  fill={statusColors.alert}
                  cursor={onBarClick ? 'pointer' : 'default'}
                  onClick={(data, index, event) => {
                    if (onBarClick && data && data.date) {
                      console.log('Bar clicked - Alert:', data);
                      onBarClick(data.date, 'Alert');
                    }
                  }}
                />
                <Bar
                  dataKey="unacceptable"
                  name="Unacceptable"
                  stackId="status"
                  fill={statusColors.unacceptable}
                  radius={[4, 4, 0, 0]}
                  cursor={onBarClick ? 'pointer' : 'default'}
                  onClick={(data, index, event) => {
                    if (onBarClick && data && data.date) {
                      console.log('Bar clicked - Unacceptable:', data);
                      onBarClick(data.date, 'Unacceptable');
                    }
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChartsSection;
