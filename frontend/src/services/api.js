// ==========================================
// API SERVICE - BACKEND INTEGRATION LAYER
// ==========================================

// Backend runs on port 8000 (FastAPI default)
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// Helper function for API calls
const fetchApi = async (endpoint, options = {}) => {
  try {
    const url = `${API_BASE_URL}${endpoint}`;
    console.log(`[API] ${options.method || 'GET'} ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`API Error [${endpoint}]:`, error);
    throw error;
  }
};

// ==========================================
// MACHINES API - Main endpoint for machine data
// Backend: GET/POST /machines
// ==========================================

export const fetchMachines = async (filters = {}) => {
  // Build query params based on backend API
  const params = new URLSearchParams();
  
  if (filters.date_from || filters.fromDate) {
    params.append('date_from', filters.date_from || filters.fromDate);
  }
  if (filters.date_to || filters.toDate) {
    params.append('date_to', filters.date_to || filters.toDate);
  }
  if (filters.customerId && filters.customerId !== 'All') {
    params.append('customerId', filters.customerId);
  }
  if (filters.areaId && filters.areaId !== 'All') {
    params.append('areaId', filters.areaId);
  }
  if (filters.status && filters.status !== 'All') {
    params.append('status', filters.status);
  }
  if (filters.machineType) {
    params.append('machineType', filters.machineType);
  }
  
  const queryString = params.toString();
  const endpoint = queryString ? `/machines?${queryString}` : '/machines';
  
  return fetchApi(endpoint);
};

export const fetchMachineById = async (machineId) => {
  return fetchApi(`/machines/${machineId}`);
};

export const fetchMachineBearingData = async (machineId, bearingId, options = {}) => {
  const params = new URLSearchParams();
  if (options.date) params.append('date', options.date);
  if (options.axis) params.append('axis', options.axis);
  if (options.data_type) params.append('data_type', options.data_type);
  if (options.analytics_type) params.append('analytics_type', options.analytics_type);
  
  const queryString = params.toString();
  const endpoint = `/machines/data/${machineId}/${bearingId}${queryString ? '?' + queryString : ''}`;
  
  return fetchApi(endpoint);
};

// ==========================================
// STATS API - For charts and analytics
// Backend: GET /stats/pie, GET /stats/stacked
// ==========================================

export const fetchPieChartData = async (date, customerId = null) => {
  const params = new URLSearchParams({ date });
  if (customerId) params.append('customerId', customerId);
  return fetchApi(`/stats/pie?${params.toString()}`);
};

export const fetchStackedChartData = async (dateFrom, dateTo, view = 'daily', customerId = null) => {
  const params = new URLSearchParams({
    date_from: dateFrom,
    date_to: dateTo,
    view: view
  });
  if (customerId) params.append('customerId', customerId);
  return fetchApi(`/stats/stacked?${params.toString()}`);
};

// ==========================================
// DERIVED DATA FUNCTIONS
// These process machine data to generate KPIs and trends
// ==========================================

// Calculate KPI data from machines response
export const calculateKpiFromMachines = (machines = []) => {
  const statusCounts = {
    totalMachines: machines.length,
    normal: 0,
    satisfactory: 0,
    alert: 0,
    unacceptable: 0
  };
  
  machines.forEach(machine => {
    const status = (machine.statusName || machine.status || '').toLowerCase();
    if (status === 'normal') statusCounts.normal++;
    else if (status === 'satisfactory') statusCounts.satisfactory++;
    else if (status === 'alert') statusCounts.alert++;
    else if (status === 'unacceptable' || status === 'unsatisfactory') statusCounts.unacceptable++;
  });
  
  return statusCounts;
};

// Extract unique filter options from machines data
export const extractFilterOptions = (machines = []) => {
  const areas = new Set(['All']);
  const customers = new Set(['All']);
  
  machines.forEach(machine => {
    if (machine.areaId && machine.areaId !== 'N/A') {
      areas.add(machine.areaId);
    }
    if (machine.customerId && machine.customerId !== 'N/A') {
      customers.add(machine.customerId);
    }
  });
  
  return {
    areaOptions: Array.from(areas),
    customerOptions: Array.from(customers)
  };
};

// Generate customer trend data from machines (group by date and customer)
export const generateCustomerTrendData = (machines = []) => {
  const dateCustomerMap = {};
  
  machines.forEach(machine => {
    // Extract date from dataUpdatedTime or use a fallback
    let dateStr = 'Unknown';
    if (machine.dataUpdatedTime && machine.dataUpdatedTime !== 'N/A') {
      try {
        const date = new Date(machine.dataUpdatedTime);
        dateStr = date.toISOString().split('T')[0];
      } catch (e) {
        dateStr = machine.dataUpdatedTime.split('T')[0];
      }
    }
    
    const customerId = machine.customerId || 'Unknown';
    
    if (!dateCustomerMap[dateStr]) {
      dateCustomerMap[dateStr] = {};
    }
    if (!dateCustomerMap[dateStr][customerId]) {
      dateCustomerMap[dateStr][customerId] = 0;
    }
    dateCustomerMap[dateStr][customerId]++;
  });
  
  // Convert to array format for Recharts
  const trendData = Object.entries(dateCustomerMap)
    .map(([date, customers]) => ({
      date,
      ...customers
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  
  return trendData;
};

// Generate status trend data from machines (group by date and status)
export const generateStatusTrendData = (machines = []) => {
  const dateStatusMap = {};
  
  machines.forEach(machine => {
    // Extract date from dataUpdatedTime or use a fallback
    let dateStr = 'Unknown';
    if (machine.dataUpdatedTime && machine.dataUpdatedTime !== 'N/A') {
      try {
        const date = new Date(machine.dataUpdatedTime);
        dateStr = date.toISOString().split('T')[0];
      } catch (e) {
        dateStr = machine.dataUpdatedTime.split('T')[0];
      }
    }
    
    const status = (machine.statusName || machine.status || 'unknown').toLowerCase();
    
    if (!dateStatusMap[dateStr]) {
      dateStatusMap[dateStr] = {
        normal: 0,
        satisfactory: 0,
        alert: 0,
        unacceptable: 0
      };
    }
    
    if (status === 'normal') dateStatusMap[dateStr].normal++;
    else if (status === 'satisfactory') dateStatusMap[dateStr].satisfactory++;
    else if (status === 'alert') dateStatusMap[dateStr].alert++;
    else if (status === 'unacceptable' || status === 'unsatisfactory') dateStatusMap[dateStr].unacceptable++;
  });
  
  // Convert to array format for Recharts
  const trendData = Object.entries(dateStatusMap)
    .map(([date, statuses]) => ({
      date,
      ...statuses
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  
  return trendData;
};

// ==========================================
// METADATA API
// ==========================================

export const fetchMetadata = async () => {
  return fetchApi('/metadata');
};

// ==========================================
// EXPORT DEFAULT
// ==========================================

export default {
  fetchMachines,
  fetchMachineById,
  fetchMachineBearingData,
  fetchPieChartData,
  fetchStackedChartData,
  calculateKpiFromMachines,
  extractFilterOptions,
  generateCustomerTrendData,
  generateStatusTrendData,
  fetchMetadata
};
