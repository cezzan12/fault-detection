// ==========================================
// API SERVICE - BACKEND INTEGRATION LAYER
// ==========================================

// Backend runs on port 8000 (FastAPI default)
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// ==========================================
// THROTTLE/RATE LIMITING
// ==========================================

// Store for tracking last call times per endpoint
const lastCallTimes = {};
const pendingCalls = {};
const MIN_INTERVAL_MS = 5000; // Minimum 5 seconds between calls to same endpoint

/**
 * Throttle function to limit API calls
 * Returns cached promise if called within MIN_INTERVAL_MS
 */
const throttledFetch = async (endpoint, options = {}) => {
  const cacheKey = `${options.method || 'GET'}:${endpoint}`;
  const now = Date.now();
  const lastCall = lastCallTimes[cacheKey] || 0;
  const timeSinceLastCall = now - lastCall;

  // If there's a pending call for this endpoint, return it
  if (pendingCalls[cacheKey]) {
    console.log(`[API] Throttled: Reusing pending call for ${cacheKey}`);
    return pendingCalls[cacheKey];
  }

  // If called too soon, wait for the remaining time
  if (timeSinceLastCall < MIN_INTERVAL_MS) {
    const waitTime = MIN_INTERVAL_MS - timeSinceLastCall;
    console.log(`[API] Throttled: Waiting ${waitTime}ms before ${cacheKey}`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  // Update last call time
  lastCallTimes[cacheKey] = Date.now();

  // Make the actual call and store the promise
  const callPromise = fetchApi(endpoint, options).finally(() => {
    // Clear pending call after completion
    delete pendingCalls[cacheKey];
  });

  pendingCalls[cacheKey] = callPromise;
  return callPromise;
};

// Helper function for API calls (raw, unthrottled)
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
// SYNC API - Keep data updated from external API
// ==========================================

export const triggerAutoSync = async () => {
  // DISABLED: Read-only mode - do not sync to AWS database
  console.log('[API] Auto-sync DISABLED - running in read-only mode');
  return { needs_sync: false, message: 'Sync disabled - read-only mode' };
  /*
  try {
    const response = await fetch(`${API_BASE_URL}/sync/auto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    return await response.json();
  } catch (error) {
    console.warn('[API] Auto-sync failed (non-blocking):', error.message);
    return { needs_sync: false, message: 'Sync unavailable' };
  }
  */
};

export const getSyncStatus = async () => {
  return fetchApi('/sync/status');
};

export const syncToday = async () => {
  // DISABLED: Read-only mode
  console.log('[API] syncToday DISABLED - running in read-only mode');
  return { message: 'Sync disabled - read-only mode', synced: 0 };
};

export const syncRecent = async (days = 7) => {
  // DISABLED: Read-only mode
  console.log('[API] syncRecent DISABLED - running in read-only mode');
  return { message: 'Sync disabled - read-only mode', synced: 0 };
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
  if (filters.limit) {
    params.append('limit', filters.limit);
  }

  const queryString = params.toString();
  const endpoint = queryString ? `/machines?${queryString}` : '/machines';

  return throttledFetch(endpoint);
};

export const fetchMachineById = async (machineId) => {
  return throttledFetch(`/machines/${machineId}`);
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

// Fetch comprehensive FFT analysis for a bearing (all axes)
export const fetchBearingFFTAnalysis = async (machineId, bearingId, options = {}) => {
  const params = new URLSearchParams();
  if (options.data_type) params.append('data_type', options.data_type);
  if (options.machine_class) params.append('machine_class', options.machine_class);

  const queryString = params.toString();
  const endpoint = `/machines/fft-analysis/${machineId}/${bearingId}${queryString ? '?' + queryString : ''}`;

  return throttledFetch(endpoint, { method: 'POST' });
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
    // Use customerName for display, fall back to customerId if name not available
    const customerName = machine.customerName || machine.customerId;
    if (customerName && customerName !== 'N/A') {
      customers.add(customerName);
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
    // Extract date from multiple possible sources
    let dateStr = 'Unknown';

    // Try 'date' field first (from transformed data)
    if (machine.date && machine.date !== 'N/A') {
      dateStr = machine.date;
    }
    // Fallback to dataUpdatedTime
    else if (machine.dataUpdatedTime && machine.dataUpdatedTime !== 'N/A') {
      try {
        const date = new Date(machine.dataUpdatedTime);
        if (!isNaN(date.getTime())) {
          dateStr = date.toISOString().split('T')[0];
        }
      } catch (e) {
        // Try to extract date string directly
        if (typeof machine.dataUpdatedTime === 'string' && machine.dataUpdatedTime.includes('-')) {
          dateStr = machine.dataUpdatedTime.split('T')[0];
        }
      }
    }

    // Use customerName instead of customerId for display
    const customerName = machine.customerName || machine.customerId || 'Unknown';

    if (!dateCustomerMap[dateStr]) {
      dateCustomerMap[dateStr] = {};
    }
    if (!dateCustomerMap[dateStr][customerName]) {
      dateCustomerMap[dateStr][customerName] = 0;
    }
    dateCustomerMap[dateStr][customerName]++;
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
// REPORT API - Backend PDF Generation
// ==========================================

/**
 * Fetch report data with FFT analysis from backend
 * @param {string} machineId - Machine ID
 * @param {string} bearingId - Optional specific bearing ID
 * @param {object} options - Optional parameters (machineClass, dataType)
 */
export const fetchReportData = async (machineId, bearingId = null, options = {}) => {
  const params = new URLSearchParams();
  if (bearingId) params.append('bearing_id', bearingId);
  if (options.machineClass) params.append('machine_class', options.machineClass);
  if (options.dataType) params.append('data_type', options.dataType);

  const queryString = params.toString();
  const endpoint = `/reports/data/${machineId}${queryString ? '?' + queryString : ''}`;

  return fetchApi(endpoint);
};

/**
 * Download PDF report generated by backend
 * @param {string} machineId - Machine ID
 * @param {string} bearingId - Optional specific bearing ID
 * @param {object} options - Optional parameters (machineClass, dataType, includeCharts)
 * @returns {Promise<Blob>} PDF blob
 */
export const downloadReport = async (machineId, bearingId = null, options = {}) => {
  const params = new URLSearchParams();
  if (bearingId) params.append('bearing_id', bearingId);
  if (options.machineClass) params.append('machine_class', options.machineClass);
  if (options.dataType) params.append('data_type', options.dataType);
  if (options.includeCharts !== undefined) params.append('include_charts', options.includeCharts);

  const queryString = params.toString();
  const endpoint = `/reports/pdf/${machineId}${queryString ? '?' + queryString : ''}`;

  try {
    const url = `${API_BASE_URL}${endpoint}`;
    console.log(`[API] GET ${url}`);

    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    return await response.blob();
  } catch (error) {
    console.error(`API Error [${endpoint}]:`, error);
    throw error;
  }
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
