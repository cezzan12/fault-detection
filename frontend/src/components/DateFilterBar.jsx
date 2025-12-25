import { useState, useEffect } from 'react';
import { Calendar, Filter, RefreshCw, Users, Clock } from 'lucide-react';
import './DateFilterBar.css';

// Get default dates
const getDefaultDates = () => {
  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  return { today, weekAgo };
};

const DateFilterBar = ({
  onApplyFilter,
  statusOptions = ['All', 'Normal', 'Satisfactory', 'Alert', 'Unacceptable'],
  customerOptions = ['All'],
  initialFilters = {}
}) => {
  const { today, weekAgo } = getDefaultDates();

  const [fromDate, setFromDate] = useState(initialFilters.fromDate || weekAgo);
  const [toDate, setToDate] = useState(initialFilters.toDate || today);
  const [status, setStatus] = useState(initialFilters.status || 'All');
  const [customerName, setCustomerName] = useState(initialFilters.customerName || 'All');

  // Update local state when initialFilters change
  useEffect(() => {
    if (initialFilters.fromDate) setFromDate(initialFilters.fromDate);
    if (initialFilters.toDate) setToDate(initialFilters.toDate);
    if (initialFilters.status) setStatus(initialFilters.status);
    if (initialFilters.customerName) setCustomerName(initialFilters.customerName);
  }, [initialFilters]);

  const handleApply = () => {
    const filters = { fromDate, toDate, status, customerName };
    console.log('Applying dashboard filters:', filters);
    if (onApplyFilter) {
      onApplyFilter(filters);
    }
  };

  const handleReset = () => {
    const { today, weekAgo } = getDefaultDates();
    setFromDate(weekAgo);
    setToDate(today);
    setStatus('All');
    setCustomerName('All');
    console.log('Filters reset');
    if (onApplyFilter) {
      onApplyFilter({ fromDate: weekAgo, toDate: today, status: 'All', customerName: 'All' });
    }
  };

  const handleToday = () => {
    const { today } = getDefaultDates();
    setFromDate(today);
    setToDate(today);
    console.log('Filtering for today:', today);
    if (onApplyFilter) {
      onApplyFilter({ fromDate: today, toDate: today, status, customerName });
    }
  };

  return (
    <div className="filter-bar">
      <div className="filter-bar-header">
        <div className="filter-bar-title">
          <Filter size={18} />
          <span>Filters</span>
        </div>
      </div>

      <div className="filter-bar-content">
        <div className="filter-group">
          <label className="filter-label">From Date</label>
          <div className="input-wrapper">
            <Calendar size={16} className="input-icon" />
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="filter-input"
            />
          </div>
        </div>

        <div className="filter-group">
          <label className="filter-label">To Date</label>
          <div className="input-wrapper">
            <Calendar size={16} className="input-icon" />
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="filter-input"
            />
          </div>
        </div>

        <div className="filter-group">
          <label className="filter-label">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="filter-select"
          >
            {statusOptions.map(s => (
              <option key={s} value={s}>
                {s === 'All' ? 'All Statuses' : s}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label className="filter-label">Customer</label>
          <select
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            className="filter-select"
          >
            {customerOptions.map(c => (
              <option key={c} value={c}>
                {c === 'All' ? 'All Customers' : (c.length > 20 ? c.substring(0, 20) + '...' : c)}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-actions">
          <button className="btn btn-today" onClick={handleToday}>
            <Clock size={16} />
            Today
          </button>
          <button className="btn btn-secondary" onClick={handleReset}>
            <RefreshCw size={16} />
            Reset
          </button>
          <button className="btn btn-primary" onClick={handleApply}>
            <Filter size={16} />
            Apply Filter
          </button>
        </div>
      </div>
    </div>
  );
};

export default DateFilterBar;
