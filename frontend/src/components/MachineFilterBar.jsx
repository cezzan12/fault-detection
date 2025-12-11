import { useState, useEffect, useRef, useMemo } from 'react';
import { Calendar, Filter, RefreshCw, MapPin, Users, Activity, Search, Cpu, Hash, Sparkles, Clock } from 'lucide-react';
import './MachineFilterBar.css';

// Get default dates
const getDefaultDates = () => {
  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  return { today, weekAgo };
};

// Search field options - added Auto Detect
const SEARCH_FIELDS = [
  { value: 'autoDetect', label: 'Auto Detect', icon: Sparkles },
  { value: 'machineName', label: 'Machine Name', icon: Cpu },
  { value: 'machineId', label: 'Machine ID', icon: Hash },
  { value: 'customerId', label: 'Customer ID', icon: Users },
  { value: 'areaId', label: 'Area ID', icon: MapPin }
];

const MachineFilterBar = ({ 
  onApplyFilter,
  areaOptions = ['All'],
  statusOptions = ['All', 'Normal', 'Satisfactory', 'Alert', 'Unsatisfactory'],
  customerOptions = ['All'],
  initialFilters = {},
  onSearch,
  machinesData = [] // Pass all machines data for autocomplete
}) => {
  const { today, weekAgo } = getDefaultDates();
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [detectedType, setDetectedType] = useState(null);
  const searchContainerRef = useRef(null);
  
  const [filters, setFilters] = useState({
    areaId: initialFilters.areaId || 'All',
    status: initialFilters.status || 'All',
    customerId: initialFilters.customerId || 'All',
    fromDate: initialFilters.fromDate || weekAgo,
    toDate: initialFilters.toDate || today
  });

  // Search state - initialize from initialFilters
  const [searchField, setSearchField] = useState(initialFilters.searchField || 'machineName');
  const [searchQuery, setSearchQuery] = useState(initialFilters.searchQuery || '');

  // Update local state when initialFilters change (e.g., from bar chart click)
  useEffect(() => {
    if (Object.keys(initialFilters).length > 0) {
      const newFilters = {
        areaId: initialFilters.areaId || 'All',
        status: initialFilters.status || 'All',
        customerId: initialFilters.customerId || 'All',
        fromDate: initialFilters.fromDate || weekAgo,
        toDate: initialFilters.toDate || today
      };
      setFilters(newFilters);
      // Also update search state
      if (initialFilters.searchField !== undefined) {
        setSearchField(initialFilters.searchField || 'machineName');
      }
      if (initialFilters.searchQuery !== undefined) {
        setSearchQuery(initialFilters.searchQuery || '');
      }
    }
  }, [initialFilters.areaId, initialFilters.status, initialFilters.customerId, initialFilters.fromDate, initialFilters.toDate, initialFilters.searchField, initialFilters.searchQuery]);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto-detect field type based on query
  const detectFieldType = (query) => {
    if (!query || !machinesData.length) return null;
    
    const q = query.toLowerCase();
    
    // Check which fields have matches
    const matches = {
      machineName: machinesData.some(m => (m.machineName || '').toLowerCase().includes(q)),
      machineId: machinesData.some(m => (m.machineId || '').toLowerCase().includes(q)),
      customerId: machinesData.some(m => (m.customerId || '').toLowerCase().includes(q)),
      areaId: machinesData.some(m => (m.areaId || '').toLowerCase().includes(q))
    };
    
    // Find the first matching field, prioritize ID fields for ID-like queries
    const matchingFields = Object.entries(matches).filter(([_, hasMatch]) => hasMatch).map(([field]) => field);
    
    if (matchingFields.length === 1) {
      return matchingFields[0];
    }
    
    // If multiple matches, try to guess by pattern
    // If it looks like an ID (contains numbers/special chars), prefer ID fields
    if (/^[a-f0-9]{20,}$/i.test(q)) {
      // MongoDB ObjectId pattern
      if (matches.machineId) return 'machineId';
      if (matches.customerId) return 'customerId';
    }
    
    return matchingFields[0] || null;
  };

  // Generate autocomplete suggestions
  const suggestions = useMemo(() => {
    if (!searchQuery || searchQuery.length < 1 || !machinesData.length) {
      return [];
    }
    
    const query = searchQuery.toLowerCase();
    const results = [];
    const seen = new Set();
    
    if (searchField === 'autoDetect') {
      // Search all fields and group by type
      const fieldTypes = ['machineName', 'machineId', 'customerId', 'areaId'];
      
      fieldTypes.forEach(field => {
        machinesData.forEach(machine => {
          const value = machine[field] || '';
          if (value && value.toLowerCase().startsWith(query) && !seen.has(`${field}:${value}`)) {
            seen.add(`${field}:${value}`);
            results.push({
              value,
              field,
              fieldLabel: SEARCH_FIELDS.find(f => f.value === field)?.label || field,
              icon: SEARCH_FIELDS.find(f => f.value === field)?.icon || Search,
              machine
            });
          }
        });
      });
      
      // Sort by field type, then alphabetically
      results.sort((a, b) => {
        const fieldOrder = { machineName: 0, machineId: 1, customerId: 2, areaId: 3 };
        if (fieldOrder[a.field] !== fieldOrder[b.field]) {
          return fieldOrder[a.field] - fieldOrder[b.field];
        }
        return a.value.localeCompare(b.value);
      });
    } else {
      // Search only the selected field
      machinesData.forEach(machine => {
        const value = machine[searchField] || '';
        if (value && value.toLowerCase().startsWith(query) && !seen.has(value)) {
          seen.add(value);
          results.push({
            value,
            field: searchField,
            fieldLabel: SEARCH_FIELDS.find(f => f.value === searchField)?.label || searchField,
            icon: SEARCH_FIELDS.find(f => f.value === searchField)?.icon || Search,
            machine
          });
        }
      });
      
      // Sort alphabetically
      results.sort((a, b) => a.value.localeCompare(b.value));
    }
    
    // Limit to 10 suggestions
    return results.slice(0, 10);
  }, [searchQuery, searchField, machinesData]);

  // Update detected type when query changes in auto-detect mode
  useEffect(() => {
    if (searchField === 'autoDetect' && searchQuery) {
      const detected = detectFieldType(searchQuery);
      setDetectedType(detected);
    } else {
      setDetectedType(null);
    }
  }, [searchQuery, searchField, machinesData]);

  const handleChange = (field, value) => {
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  const handleApply = () => {
    console.log('Applying machine filters:', filters);
    if (onApplyFilter) {
      onApplyFilter({ ...filters, searchField, searchQuery });
    }
  };

  const handleSearch = () => {
    console.log('Searching:', searchField, searchQuery);
    setShowSuggestions(false);
    
    // For auto-detect, use the detected field type
    const effectiveField = searchField === 'autoDetect' ? (detectedType || 'autoDetect') : searchField;
    
    if (onApplyFilter) {
      onApplyFilter({ ...filters, searchField: effectiveField, searchQuery });
    }
  };

  const handleSearchKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSearch();
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  const handleSearchInputChange = (e) => {
    const value = e.target.value;
    setSearchQuery(value);
    setShowSuggestions(value.length > 0);
  };

  const handleSuggestionClick = (suggestion) => {
    setSearchQuery(suggestion.value);
    setShowSuggestions(false);
    
    // If auto-detect, switch to the detected field type
    if (searchField === 'autoDetect') {
      setSearchField(suggestion.field);
    }
    
    // Apply the search immediately
    if (onApplyFilter) {
      onApplyFilter({ ...filters, searchField: suggestion.field, searchQuery: suggestion.value });
    }
  };

  const handleReset = () => {
    const { today, weekAgo } = getDefaultDates();
    const resetFilters = {
      areaId: 'All',
      status: 'All',
      customerId: 'All',
      fromDate: weekAgo,
      toDate: today
    };
    setFilters(resetFilters);
    setSearchQuery('');
    setSearchField('autoDetect');
    setShowSuggestions(false);
    setDetectedType(null);
    console.log('Filters reset');
    if (onApplyFilter) {
      onApplyFilter({ ...resetFilters, searchField: 'autoDetect', searchQuery: '' });
    }
  };

  const handleToday = () => {
    const { today } = getDefaultDates();
    const todayFilters = {
      ...filters,
      fromDate: today,
      toDate: today
    };
    setFilters(todayFilters);
    console.log('Today filter set (click Apply Filter to apply):', today);
    // Apply immediately to show today's data
    if (onApplyFilter) {
      onApplyFilter({ ...todayFilters, searchField, searchQuery });
    }
  };

  const SelectedIcon = SEARCH_FIELDS.find(f => f.value === searchField)?.icon || Search;

  return (
    <div className="machine-filter-bar">
      <div className="filter-bar-header">
        <div className="filter-bar-title">
          <Filter size={18} />
          <span>Filter Machines</span>
        </div>
      </div>
      
      <div className="filter-bar-content">
        {/* Search Bar Row */}
        <div className="search-row">
          <div className="search-container" ref={searchContainerRef}>
            <div className="search-field-selector">
              <select
                value={searchField}
                onChange={(e) => {
                  setSearchField(e.target.value);
                  setShowSuggestions(searchQuery.length > 0);
                }}
                className="search-field-select"
              >
                {SEARCH_FIELDS.map(field => (
                  <option key={field.value} value={field.value}>
                    {field.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="search-input-container">
              <div className="search-input-wrapper">
                <SelectedIcon size={16} className="search-icon" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={handleSearchInputChange}
                  onKeyDown={handleSearchKeyPress}
                  onFocus={() => searchQuery.length > 0 && setShowSuggestions(true)}
                  placeholder={searchField === 'autoDetect' 
                    ? 'Type to search any field...' 
                    : `Search by ${SEARCH_FIELDS.find(f => f.value === searchField)?.label || 'field'}...`}
                  className="search-input"
                />
                {searchQuery && (
                  <button 
                    className="search-clear-btn"
                    onClick={() => {
                      setSearchQuery('');
                      setShowSuggestions(false);
                      setDetectedType(null);
                      if (onApplyFilter) {
                        onApplyFilter({ ...filters, searchField, searchQuery: '' });
                      }
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
              
              {/* Autocomplete Dropdown */}
              {showSuggestions && suggestions.length > 0 && (
                <div className="search-suggestions-dropdown">
                  {searchField === 'autoDetect' && detectedType && (
                    <div className="suggestions-detected-type">
                      <Sparkles size={12} />
                      <span>Detected: {SEARCH_FIELDS.find(f => f.value === detectedType)?.label}</span>
                    </div>
                  )}
                  {suggestions.map((suggestion, index) => {
                    const SuggestionIcon = suggestion.icon;
                    return (
                      <div 
                        key={`${suggestion.field}-${suggestion.value}-${index}`}
                        className="suggestion-item"
                        onClick={() => handleSuggestionClick(suggestion)}
                      >
                        <SuggestionIcon size={14} className="suggestion-icon" />
                        <div className="suggestion-content">
                          <span className="suggestion-value">{suggestion.value}</span>
                          {searchField === 'autoDetect' && (
                            <span className="suggestion-type">{suggestion.fieldLabel}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <button className="btn btn-primary search-btn" onClick={handleSearch}>
              <Search size={16} />
              Search
            </button>
          </div>
        </div>

        <div className="filter-row">
          <div className="filter-group">
            <label className="filter-label">
              <MapPin size={14} />
              Area ID
            </label>
            <select
              value={filters.areaId}
              onChange={(e) => handleChange('areaId', e.target.value)}
              className="filter-select"
            >
              {areaOptions.map(area => (
                <option key={area} value={area}>{area}</option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label className="filter-label">
              <Activity size={14} />
              Status
            </label>
            <select
              value={filters.status}
              onChange={(e) => handleChange('status', e.target.value)}
              className="filter-select"
            >
              {statusOptions.map(status => (
                <option key={status} value={status}>
                  {status === 'All' ? 'All Statuses' : status.charAt(0).toUpperCase() + status.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label className="filter-label">
              <Users size={14} />
              Customer ID
            </label>
            <select
              value={filters.customerId}
              onChange={(e) => handleChange('customerId', e.target.value)}
              className="filter-select"
            >
              {customerOptions.map(customer => (
                <option key={customer} value={customer}>
                  {customer === 'All' ? 'All Customers' : (customer.length > 20 ? customer.substring(0, 20) + '...' : customer)}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label className="filter-label">
              <Calendar size={14} />
              From Date
            </label>
            <input
              type="date"
              value={filters.fromDate}
              onChange={(e) => handleChange('fromDate', e.target.value)}
              className="filter-input"
            />
          </div>

          <div className="filter-group">
            <label className="filter-label">
              <Calendar size={14} />
              To Date
            </label>
            <input
              type="date"
              value={filters.toDate}
              onChange={(e) => handleChange('toDate', e.target.value)}
              className="filter-input"
            />
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
    </div>
  );
};

export default MachineFilterBar;
