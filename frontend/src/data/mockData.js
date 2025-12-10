// ==========================================
// DATA STRUCTURE DEFINITIONS FOR BACKEND INTEGRATION
// ==========================================

// These are placeholder/default values - will be replaced by API calls

// KPI Summary Data Structure
export const defaultKpiData = {
  totalMachines: 0,
  normal: 0,
  satisfactory: 0,
  alert: 0,
  unacceptable: 0,
};

// Customer Trend Data Structure (empty array - will come from API)
export const defaultCustomerTrendData = [];

// Machine Status Trends Data Structure (empty array - will come from API)
export const defaultStatusTrendData = [];

// Machines Data Structure (empty array - will come from API)
export const defaultMachinesData = [];

// Filter Options - these can also come from API if needed
export const defaultAreaOptions = ['All'];
export const defaultStatusOptions = ['All', 'normal', 'satisfactory', 'alert', 'unacceptable'];
export const defaultCustomerOptions = ['All'];
