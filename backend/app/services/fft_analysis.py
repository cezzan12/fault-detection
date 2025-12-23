"""
FFT Analysis Service for Bearing Condition Monitoring

This module provides FFT-based analysis for bearing condition monitoring and fault diagnosis.
All calculations use only real sensor data - no assumptions or dummy values.
"""

import numpy as np
import math
from scipy import signal
import scipy.integrate
from typing import Dict, List, Optional, Tuple, Any
import logging

# ISO 10816-3 Velocity RMS thresholds (mm/s) for different machine classes
# Note: Using 99999 instead of inf for JSON compatibility
ISO_THRESHOLDS = {
    'I': {'A': 0.71, 'B': 1.8, 'C': 4.5, 'D': 99999},   # Small machines
    'II': {'A': 1.12, 'B': 2.8, 'C': 7.1, 'D': 99999},  # Medium machines
    'III': {'A': 1.8, 'B': 4.5, 'C': 11.2, 'D': 99999}, # Large rigid
    'IV': {'A': 2.8, 'B': 7.1, 'C': 18.0, 'D': 99999}   # Large flexible
}

ZONE_LABELS = {
    'A': 'Normal',
    'B': 'Satisfactory', 
    'C': 'Alert',
    'D': 'Unacceptable'
}

ZONE_COLORS = {
    'A': '#10b981',  # Green
    'B': '#06b6d4',  # Cyan
    'C': '#f59e0b',  # Orange
    'D': '#ef4444'   # Red
}


def sanitize_float(value):
    """Convert nan/inf values to JSON-safe values."""
    import math
    if value is None:
        return None
    if isinstance(value, float):
        if math.isnan(value):
            return 0.0
        if math.isinf(value):
            return 99999.0 if value > 0 else -99999.0
    return value


def sanitize_dict(obj):
    """Recursively sanitize a dict/list to ensure JSON serializability."""
    if isinstance(obj, dict):
        return {k: sanitize_dict(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [sanitize_dict(item) for item in obj]
    elif isinstance(obj, float):
        return sanitize_float(obj)
    return obj


# ==========================================
# SIGNAL PROCESSING FUNCTIONS
# ==========================================

def butter_highpass(cutoff: float, fs: float, order: int = 2) -> Tuple[np.ndarray, np.ndarray]:
    """
    Design a Butterworth highpass filter.
    
    Args:
        cutoff: Cutoff frequency in Hz
        fs: Sampling frequency in Hz
        order: Filter order (default 2)
        
    Returns:
        Tuple of (b, a) filter coefficients
    """
    nyq = 0.5 * fs
    normal_cutoff = cutoff / nyq
    b, a = signal.butter(order, normal_cutoff, btype='highpass', analog=False)
    return b, a


def butter_highpass_filter(data: np.ndarray, cutoff: float, fs: float, order: int = 2) -> np.ndarray:
    """
    Apply a Butterworth highpass filter to the data.
    
    Args:
        data: Input signal
        cutoff: Cutoff frequency in Hz
        fs: Sampling frequency in Hz
        order: Filter order (default 2)
        
    Returns:
        Filtered signal
    """
    b, a = butter_highpass(cutoff, fs, order=order)
    y = signal.filtfilt(b, a, data)
    return y


def hann_data(data: np.ndarray) -> np.ndarray:
    """
    Apply Hanning window to the data.
    
    Args:
        data: Input signal
        
    Returns:
        Windowed signal
    """
    window = signal.windows.hann(len(data))
    return data * window


def FFT_simple(temp: np.ndarray) -> np.ndarray:
    """
    Compute single-sided FFT amplitude spectrum.
    
    Args:
        temp: Input time-domain signal
        
    Returns:
        Single-sided amplitude spectrum (DC component zeroed)
    """
    N = len(temp)
    yf = np.fft.fft(temp)
    yf = 2.0/N * np.abs(yf[:N//2])
    yf[0] = 0  # Zero DC component
    return yf


def velocity_convert(rawData: List[float], 
                     SR: float, 
                     RPM: float, 
                     cutoff: float = 4,
                     fmax: Optional[float] = None,
                     floorNoiseThresholdPercentage: Optional[float] = None,
                     floorNoiseAttenuationFactor: Optional[float] = None,
                     highResolution: int = 1,
                     calibrationValue: float = 1.0) -> Dict[str, Any]:
    """
    Convert acceleration data to velocity and compute FFT using overlapping block averaging.
    
    This is the correct signal processing pipeline:
    1. Convert acceleration from g to mm/s^2 
    2. Remove DC offset
    3. Integrate acceleration to velocity
    4. Apply Butterworth highpass filter
    5. Use overlapping blocks with Hanning window
    6. Average FFT across blocks
    7. Apply floor noise attenuation
    8. Apply calibration value
    
    Args:
        rawData: Raw acceleration data (in g)
        SR: Sample rate in Hz
        RPM: Machine RPM
        cutoff: Highpass filter cutoff frequency (Hz)
        fmax: Maximum frequency for output (optional)
        floorNoiseThresholdPercentage: Threshold for noise attenuation (optional)
        floorNoiseAttenuationFactor: Factor to divide noise by (optional)
        highResolution: Resolution multiplier (default 1)
        calibrationValue: Calibration multiplier (default 1.0)
        
    Returns:
        Dict with SR, Timeseries data, FFT data, and frequency ranges
    """
    # Determine overlapping percentage based on data length
    if 40000 < len(rawData) < 50000:
        overlappingPercentage = 60
    else:
        overlappingPercentage = 80
    
    # Set block size based on resolution
    if highResolution > 1:
        blockSize = int(20000 * (highResolution/2))
    else:
        blockSize = 20000
    
    # Ensure we don't exceed available data
    blockSize = min(blockSize, len(rawData))
    
    # Convert acceleration from g to mm/s^2
    velocity_Timeseries_mms2 = np.array(rawData) * 9807
    
    N = min(blockSize, len(velocity_Timeseries_mms2))
    time_step = 1 / SR
    time = np.linspace(0.0, N * time_step, N)
    
    # Remove DC offset
    velocity_Timeseries_mms2 = velocity_Timeseries_mms2 - np.mean(velocity_Timeseries_mms2)
    
    # Integrate acceleration to velocity
    time_array = np.linspace(0.0, len(velocity_Timeseries_mms2) * time_step, len(velocity_Timeseries_mms2))
    velocity_Timeseries = scipy.integrate.cumulative_trapezoid(velocity_Timeseries_mms2, x=time_array, initial=0)
    
    # Use cutoff frequency (can be adjusted based on RPM)
    rms_cutoff_value = cutoff
    
    # Apply highpass filter to full timeseries
    final_velocity_Timeseries = butter_highpass_filter(velocity_Timeseries, rms_cutoff_value, SR, 2)
    
    # Compute FFT using overlapping blocks
    velocity_FFT_Data_list = []
    num_blocks = 4
    
    for i in range(num_blocks):
        start = int(i * (1 - (overlappingPercentage / 100)) * blockSize)
        end = start + blockSize
        
        if end > len(velocity_Timeseries_mms2):
            break
            
        # Integrate block to velocity
        block_time = np.linspace(0.0, (end - start) * time_step, end - start)
        velocity_Timeseries_i = scipy.integrate.cumulative_trapezoid(
            velocity_Timeseries_mms2[start:end], 
            x=block_time,
            initial=0
        )
        
        # Apply highpass filter
        velocity_Timeseries_i = butter_highpass_filter(velocity_Timeseries_i, rms_cutoff_value, SR, 2)
        
        # Apply Hanning window and compute FFT, multiply by 2 for amplitude correction
        velocity_FFT_Data_i = FFT_simple(hann_data(velocity_Timeseries_i)) * 2
        velocity_FFT_Data_list.append(velocity_FFT_Data_i)
    
    # Average FFT across blocks
    if velocity_FFT_Data_list:
        # Ensure all arrays have the same length
        min_len = min(len(arr) for arr in velocity_FFT_Data_list)
        velocity_FFT_Data_list = [arr[:min_len] for arr in velocity_FFT_Data_list]
        velocity_FFT_Data = sum(velocity_FFT_Data_list) / len(velocity_FFT_Data_list)
    else:
        # Fallback to single block FFT
        velocity_FFT_Data = FFT_simple(hann_data(final_velocity_Timeseries[:blockSize])) * 2
    
    # Generate frequency axis
    velocity_FFT_X_Data = np.linspace(0.0, SR / 2, num=len(velocity_FFT_Data))
    
    # Apply floor noise attenuation
    if floorNoiseThresholdPercentage not in (None, 0) and floorNoiseAttenuationFactor not in (None, 0):
        threshold = np.max(velocity_FFT_Data) * floorNoiseThresholdPercentage
        velocity_FFT_Data = np.where(
            velocity_FFT_Data < threshold, 
            velocity_FFT_Data / floorNoiseAttenuationFactor, 
            velocity_FFT_Data
        )
    else:
        # Default attenuation
        velocity_FFT_Data = np.where(
            velocity_FFT_Data < (np.max(velocity_FFT_Data) * 0.05), 
            velocity_FFT_Data / 1.1, 
            velocity_FFT_Data
        )
    
    # Attenuate frequencies below cutoff
    cutoff_idx = np.where(velocity_FFT_X_Data > rms_cutoff_value)[0]
    if len(cutoff_idx) > 0:
        velocity_FFT_Data[:cutoff_idx[0]] *= 0.2
    
    cutoff_75_idx = np.where(velocity_FFT_X_Data > (rms_cutoff_value * 0.75))[0]
    if len(cutoff_75_idx) > 0:
        velocity_FFT_Data[:cutoff_75_idx[0]] *= 0.05
    
    # Apply calibration and round
    velocity_FFT_Data = np.round(velocity_FFT_Data, 8) * calibrationValue
    
    # Limit to fmax if specified
    if fmax is not None:
        filtered_indices = velocity_FFT_X_Data < fmax
        Final_Velocity_FFT_Data = list(zip(velocity_FFT_X_Data[filtered_indices], velocity_FFT_Data[filtered_indices]))
    else:
        Final_Velocity_FFT_Data = list(zip(velocity_FFT_X_Data, velocity_FFT_Data))
    
    # Generate timeseries output
    v1 = (len(final_velocity_Timeseries) / SR) / len(final_velocity_Timeseries)
    final_Timeseries_Data = np.round(final_velocity_Timeseries, 8)
    Final_Velocity_Temp_Data = [[i * v1, float(final_Timeseries_Data[i])] for i in range(len(final_Timeseries_Data))]
    
    return {
        "SR": SR,
        "twf_min": Final_Velocity_Temp_Data[0][0] if Final_Velocity_Temp_Data else 0,
        "twf_max": Final_Velocity_Temp_Data[-1][0] if Final_Velocity_Temp_Data else 0,
        "Timeseries": Final_Velocity_Temp_Data,
        "fft_min": Final_Velocity_FFT_Data[0][0] if Final_Velocity_FFT_Data else 0,
        "fft_max": Final_Velocity_FFT_Data[-1][0] if Final_Velocity_FFT_Data else 0,
        "FFT": Final_Velocity_FFT_Data
    }


def acceleration_convert(Data: List[float], SR: float, fmax: Optional[float] = None) -> Dict[str, Any]:
    """
    Process acceleration data and compute FFT.
    
    Args:
        Data: Raw acceleration data
        SR: Sample rate in Hz
        fmax: Maximum frequency for output (optional)
        
    Returns:
        Dict with SR, Timeseries data, FFT data, and frequency ranges
    """
    Acceleration_Timeseries_Data = np.array(Data)
    
    Filter_Cutoff = 10
    Filter_Order = 4
    
    # Apply highpass filter
    first_filter_data = butter_highpass_filter(Acceleration_Timeseries_Data, Filter_Cutoff, SR, Filter_Order)
    
    # Compute FFT with Hanning window and amplitude correction
    Acceleration_FFT_Data = (FFT_simple(hann_data(first_filter_data)) * 0.707) * 2.1
    
    # Generate frequency axis
    Acceleration_FFT_X_Data = np.linspace(0.0, SR / 2, num=len(Acceleration_FFT_Data))
    
    # Limit to fmax if specified
    if fmax is not None:
        filtered_indices = Acceleration_FFT_X_Data < fmax
        Final_Acceleration_FFT_Data = list(zip(
            Acceleration_FFT_X_Data[filtered_indices], 
            Acceleration_FFT_Data[filtered_indices]
        ))
    else:
        Final_Acceleration_FFT_Data = list(zip(Acceleration_FFT_X_Data, Acceleration_FFT_Data))
    
    # Trim first 10% of timeseries (startup artifacts)
    Acceleration_Timeseries_Data = Acceleration_Timeseries_Data[int(len(Acceleration_Timeseries_Data) * 0.1):]
    
    # Generate timeseries output
    v1 = (len(Acceleration_Timeseries_Data) / SR) / len(Acceleration_Timeseries_Data)
    Final_Acceleration_Timeseries_Data = [
        [i * v1, float(Acceleration_Timeseries_Data[i])] 
        for i in range(len(Acceleration_Timeseries_Data))
    ]
    
    return {
        "SR": SR,
        "twf_min": Final_Acceleration_Timeseries_Data[0][0] if Final_Acceleration_Timeseries_Data else 0,
        "twf_max": Final_Acceleration_Timeseries_Data[-1][0] if Final_Acceleration_Timeseries_Data else 0,
        "Timeseries": Final_Acceleration_Timeseries_Data,
        "fft_min": Final_Acceleration_FFT_Data[0][0] if Final_Acceleration_FFT_Data else 0,
        "fft_max": Final_Acceleration_FFT_Data[-1][0] if Final_Acceleration_FFT_Data else 0,
        "FFT": Final_Acceleration_FFT_Data
    }

def compute_fft(raw_data: List[float], sample_rate: float) -> Tuple[np.ndarray, np.ndarray]:
    """
    Compute FFT of time-domain vibration data using Hanning window.
    (Legacy function - kept for compatibility, use velocity_convert or acceleration_convert for full pipeline)
    
    Args:
        raw_data: Time-domain vibration signal
        sample_rate: Sampling rate in Hz
        
    Returns:
        Tuple of (frequencies, amplitudes)
    """
    if not raw_data or len(raw_data) < 2:
        raise ValueError("Insufficient data for FFT computation")
    
    data = np.array(raw_data)
    n = len(data)
    
    # Apply Hanning window to reduce spectral leakage
    window = np.hanning(n)
    windowed_data = data * window
    
    # Compute FFT
    fft_result = np.fft.rfft(windowed_data)
    
    # Calculate frequency bins
    freqs = np.fft.rfftfreq(n, d=1.0/sample_rate)
    
    # Calculate amplitude (single-sided spectrum)
    # Multiply by 2 for single-sided spectrum (except DC and Nyquist)
    amplitudes = np.abs(fft_result) / n * 2
    amplitudes[0] /= 2  # DC component
    if n % 2 == 0:
        amplitudes[-1] /= 2  # Nyquist component
    
    # Convert to velocity RMS (mm/s) if data is acceleration
    # Assuming input is already velocity or converted
    
    return freqs, amplitudes


def find_peak_in_band(freqs: np.ndarray, amplitudes: np.ndarray, 
                      center_freq: float, tolerance: float = 0.05) -> Optional[Dict]:
    """
    Find the peak within ±tolerance of the center frequency.
    
    Args:
        freqs: Frequency array from FFT
        amplitudes: Amplitude array from FFT
        center_freq: Target center frequency (Hz)
        tolerance: Tolerance band (default 5%)
        
    Returns:
        Dict with peak frequency and amplitude, or None if not found
    """
    if center_freq <= 0:
        return None
    
    lower_bound = center_freq * (1 - tolerance)
    upper_bound = center_freq * (1 + tolerance)
    
    # Find indices within the tolerance band
    mask = (freqs >= lower_bound) & (freqs <= upper_bound)
    
    if not np.any(mask):
        return None
    
    band_freqs = freqs[mask]
    band_amps = amplitudes[mask]
    
    # Find peak within the band
    peak_idx = np.argmax(band_amps)
    
    return {
        'frequency': float(band_freqs[peak_idx]),
        'amplitude': float(band_amps[peak_idx]),
        'targetFrequency': center_freq,
        'tolerance': tolerance
    }


def detect_harmonics(freqs: np.ndarray, amplitudes: np.ndarray, 
                     running_freq: float, num_harmonics: int = 10,
                     tolerance: float = 0.05, 
                     min_amplitude_ratio: float = 0.1) -> List[Dict]:
    """
    Detect harmonics of the running frequency.
    
    Args:
        freqs: Frequency array from FFT
        amplitudes: Amplitude array from FFT
        running_freq: Running frequency in Hz
        num_harmonics: Number of harmonics to detect (1×, 2×, ... n×)
        tolerance: Tolerance band (default 5%)
        min_amplitude_ratio: Minimum amplitude as ratio of 1× peak to be considered significant
        
    Returns:
        List of detected harmonics
    """
    if running_freq <= 0:
        return []
    
    harmonics = []
    
    # First find the 1× peak to establish reference amplitude
    peak_1x = find_peak_in_band(freqs, amplitudes, running_freq, tolerance)
    reference_amplitude = peak_1x['amplitude'] if peak_1x else 0.1
    
    for n in range(1, num_harmonics + 1):
        target_freq = running_freq * n
        
        # Skip if target frequency exceeds available range
        if target_freq > freqs[-1]:
            break
        
        peak = find_peak_in_band(freqs, amplitudes, target_freq, tolerance)
        
        if peak:
            # Check if peak is significant
            is_significant = peak['amplitude'] >= reference_amplitude * min_amplitude_ratio
            harmonics.append({
                'harmonic': n,
                'label': f'{n}×',
                'targetFrequency': target_freq,
                'detectedFrequency': peak['frequency'],
                'amplitude': peak['amplitude'],
                'isSignificant': is_significant
            })
    
    return harmonics


def detect_fixed_frequencies(freqs: np.ndarray, amplitudes: np.ndarray,
                            target_freqs: List[float] = [25, 50, 75, 100, 125],
                            tolerance: float = 0.05) -> List[Dict]:
    """
    Detect peaks at specific fixed frequencies (electrical frequencies).
    
    Args:
        freqs: Frequency array from FFT
        amplitudes: Amplitude array from FFT
        target_freqs: List of target frequencies to detect
        tolerance: Tolerance band (default 5%)
        
    Returns:
        List of detected peaks
    """
    detected = []
    
    for target in target_freqs:
        if target > freqs[-1]:
            continue
            
        peak = find_peak_in_band(freqs, amplitudes, target, tolerance)
        
        if peak:
            detected.append({
                'targetFrequency': target,
                'detectedFrequency': peak['frequency'],
                'amplitude': peak['amplitude']
            })
    
    return detected


def get_iso_severity_zone(velocity_rms: float, machine_class: str = 'II') -> Dict:
    """
    Determine ISO 10816-3 severity zone based on velocity RMS.
    
    Args:
        velocity_rms: Velocity RMS value in mm/s
        machine_class: Machine class ('I', 'II', 'III', 'IV')
        
    Returns:
        Dict with zone, label, color
    """
    if machine_class not in ISO_THRESHOLDS:
        machine_class = 'II'  # Default to medium machines
    
    thresholds = ISO_THRESHOLDS[machine_class]
    
    if velocity_rms <= thresholds['A']:
        zone = 'A'
    elif velocity_rms <= thresholds['B']:
        zone = 'B'
    elif velocity_rms <= thresholds['C']:
        zone = 'C'
    else:
        zone = 'D'
    
    return {
        'zone': zone,
        'label': ZONE_LABELS[zone],
        'color': ZONE_COLORS[zone],
        'velocityRMS': round(velocity_rms, 3),
        'machineClass': machine_class,
        'thresholds': thresholds
    }


def diagnose_bearing_fault(harmonics: List[Dict], 
                           fixed_freq_peaks: List[Dict],
                           axial_amplitude: Optional[float] = None,
                           horizontal_amplitude: Optional[float] = None,
                           vertical_amplitude: Optional[float] = None) -> Dict:
    """
    Diagnose probable bearing fault based on spectral characteristics.
    
    Args:
        harmonics: List of detected harmonics
        fixed_freq_peaks: List of detected fixed frequency peaks
        axial_amplitude: 1× amplitude on axial axis (optional)
        horizontal_amplitude: 1× amplitude on horizontal axis (optional)
        vertical_amplitude: 1× amplitude on vertical axis (optional)
        
    Returns:
        Dict with fault type, confidence, evidence, recommendation
    """
    evidence = []
    fault_scores = {
        'Unbalance': 0,
        'Misalignment': 0,
        'Mechanical Looseness': 0,
        'Electrical Issues': 0,
        'Normal': 0
    }
    
    # Count significant harmonics
    significant_harmonics = [h for h in harmonics if h.get('isSignificant', False)]
    harmonic_count = len(significant_harmonics)
    
    # Get 1× and 2× amplitudes
    amp_1x = next((h['amplitude'] for h in harmonics if h['harmonic'] == 1), 0)
    amp_2x = next((h['amplitude'] for h in harmonics if h['harmonic'] == 2), 0)
    
    # Check for higher harmonics (3× and above)
    higher_harmonics = [h for h in significant_harmonics if h['harmonic'] >= 3]
    
    # Fault detection logic
    
    # 1. Unbalance: Dominant 1× peak, minimal higher harmonics
    if amp_1x > 0 and harmonic_count <= 2:
        fault_scores['Unbalance'] += 3
        evidence.append('Dominant 1× running frequency peak')
        if amp_2x < amp_1x * 0.3:
            fault_scores['Unbalance'] += 2
            evidence.append('Low harmonic content')
    
    # 2. Misalignment: Strong 1× and 2× peaks
    if amp_2x > amp_1x * 0.5:
        fault_scores['Misalignment'] += 3
        evidence.append('Elevated 2× harmonic relative to 1×')
    
    # Check axial vibration for misalignment
    if axial_amplitude is not None and horizontal_amplitude is not None:
        if axial_amplitude > horizontal_amplitude * 0.5:
            fault_scores['Misalignment'] += 2
            evidence.append('Elevated axial vibration')
    
    # 3. Mechanical Looseness: Multiple harmonics
    if harmonic_count >= 4:
        fault_scores['Mechanical Looseness'] += 3
        evidence.append(f'Multiple harmonics detected ({harmonic_count}×)')
    
    if len(higher_harmonics) >= 3:
        fault_scores['Mechanical Looseness'] += 2
        evidence.append('Significant higher harmonic content (3× and above)')
    
    # 4. Electrical Issues: Peaks at electrical frequencies
    if len(fixed_freq_peaks) >= 2:
        fault_scores['Electrical Issues'] += 2
        evidence.append(f'Peaks at electrical frequencies ({len(fixed_freq_peaks)} detected)')
    
    # 5. Normal: Low overall vibration
    if harmonic_count <= 1 and amp_1x < 1.0:  # Low threshold
        fault_scores['Normal'] += 3
        evidence.append('Low overall vibration levels')
    
    # Determine fault type
    max_score = max(fault_scores.values())
    fault_type = max(fault_scores, key=fault_scores.get)
    
    # Determine confidence level
    if max_score >= 5:
        confidence = 'High'
    elif max_score >= 3:
        confidence = 'Medium'
    else:
        confidence = 'Low'
    
    # Determine recommendation
    recommendations = {
        'Normal': 'Continue regular monitoring',
        'Unbalance': 'Schedule balancing service',
        'Misalignment': 'Check and correct alignment',
        'Mechanical Looseness': 'Inspect mounting and fasteners',
        'Electrical Issues': 'Check electrical connections'
    }
    
    # Severity-based recommendations
    if fault_type != 'Normal' and confidence == 'High':
        action = 'Immediate Inspection Required'
        action_color = '#ef4444'  # Red
    elif fault_type != 'Normal' and confidence == 'Medium':
        action = 'Schedule Inspection'
        action_color = '#f59e0b'  # Orange
    else:
        action = 'Monitor'
        action_color = '#10b981'  # Green
    
    return {
        'faultType': fault_type,
        'confidence': confidence,
        'harmonicCount': harmonic_count,
        'evidence': evidence if evidence else ['No specific fault indicators detected'],
        'recommendation': recommendations.get(fault_type, 'Monitor'),
        'action': action,
        'actionColor': action_color
    }


def perform_complete_analysis(raw_data: List[float], 
                              sample_rate: float,
                              rpm: float,
                              axis: str = 'V',
                              machine_class: str = 'II',
                              cutoff: float = 4.0,
                              calibration_value: float = 1.0,
                              floor_noise_threshold: Optional[float] = None,
                              floor_noise_attenuation: Optional[float] = None) -> Dict[str, Any]:
    """
    Perform complete FFT analysis on vibration data using proper signal processing.
    
    This uses the correct signal processing pipeline:
    1. Butterworth highpass filtering
    2. Acceleration to velocity conversion (integration)
    3. Overlapping block FFT with Hanning window
    4. Block averaging for smoother spectrum
    5. Floor noise attenuation
    6. Calibration value application
    
    Args:
        raw_data: Time-domain vibration signal (acceleration in g)
        sample_rate: Sampling rate in Hz
        rpm: Machine RPM
        axis: Axis identifier (H, V, A)
        machine_class: ISO machine class
        cutoff: Highpass filter cutoff frequency (Hz), default 4
        calibration_value: Calibration multiplier, default 1.0
        floor_noise_threshold: Threshold percentage for noise attenuation (optional)
        floor_noise_attenuation: Factor to divide noise by (optional)
        
    Returns:
        Complete analysis results with FFT spectrum, peaks, harmonics, and diagnosis
    """
    logging.info(f"Starting FFT analysis for axis {axis}, RPM={rpm}, SR={sample_rate}, data points={len(raw_data)}")
    
    # Validate inputs
    if rpm is None or rpm <= 0:
        raise ValueError("Valid RPM is required for analysis")
    
    if not raw_data or len(raw_data) < 100:
        raise ValueError("Insufficient vibration data for analysis")
    
    if sample_rate <= 0:
        raise ValueError("Valid sample rate is required")
    
    # Calculate running frequency
    running_freq = rpm / 60.0
    logging.info(f"Running frequency: {running_freq:.2f} Hz")
    
    # Calculate fmax for FFT output (12× running frequency)
    fmax = min(running_freq * 12, sample_rate / 2)
    
    # Use the new velocity conversion with proper signal processing
    velocity_result = velocity_convert(
        rawData=raw_data,
        SR=sample_rate,
        RPM=rpm,
        cutoff=cutoff,
        fmax=fmax,
        floorNoiseThresholdPercentage=floor_noise_threshold,
        floorNoiseAttenuationFactor=floor_noise_attenuation,
        calibrationValue=calibration_value
    )
    
    # Extract FFT data from velocity conversion result
    fft_data = velocity_result.get('FFT', [])
    
    # Convert to numpy arrays for analysis
    if fft_data:
        freqs = np.array([point[0] for point in fft_data])
        amplitudes = np.array([point[1] for point in fft_data])
    else:
        # Fallback to legacy compute_fft if velocity conversion fails
        freqs, amplitudes = compute_fft(raw_data, sample_rate)
    
    # Limit output for frontend performance
    max_points = 2000
    if len(freqs) > max_points:
        step = len(freqs) // max_points
        output_freqs = freqs[::step]
        output_amps = amplitudes[::step]
    else:
        output_freqs = freqs
        output_amps = amplitudes
    
    # Create FFT spectrum for visualization
    fft_spectrum = [
        {'frequency': float(f), 'amplitude': float(a)} 
        for f, a in zip(output_freqs, output_amps)
    ]
    
    # Find peak at 1× running frequency
    peak_1x = find_peak_in_band(freqs, amplitudes, running_freq)
    
    # Detect harmonics
    harmonics = detect_harmonics(freqs, amplitudes, running_freq)
    
    # Detect fixed frequencies
    fixed_freq_peaks = detect_fixed_frequencies(freqs, amplitudes)
    
    # Calculate overall velocity RMS from relevant frequency range
    low_cutoff = 10.0  # Hz
    high_cutoff = min(1000.0, freqs[-1] if len(freqs) > 0 else 1000.0)  # Hz
    freq_mask = (freqs >= low_cutoff) & (freqs <= high_cutoff)
    relevant_amps = amplitudes[freq_mask] if np.any(freq_mask) else amplitudes
    
    # Calculate RMS of all amplitudes in the relevant frequency range
    velocity_rms_overall = float(np.sqrt(np.sum(relevant_amps ** 2))) if len(relevant_amps) > 0 else 0
    
    # Also keep the 1× peak amplitude for reference
    velocity_rms_1x = peak_1x['amplitude'] if peak_1x else 0
    
    # Use the HIGHER of the two for severity (more conservative/safer)
    velocity_rms = max(velocity_rms_overall, velocity_rms_1x)
    
    # Get ISO severity
    severity = get_iso_severity_zone(velocity_rms, machine_class)
    
    # Perform fault diagnosis
    diagnosis = diagnose_bearing_fault(harmonics, fixed_freq_peaks)
    
    result = {
        'axis': axis,
        'rpm': rpm,
        'runningFrequency': round(running_freq, 2),
        'sampleRate': sample_rate,
        'dataPoints': len(raw_data),
        'fftSpectrum': fft_spectrum,
        'timeseries': velocity_result.get('Timeseries', [])[:1000],  # Limit timeseries for frontend
        'peakAt1x': peak_1x,
        'harmonics': harmonics,
        'harmonicCount': len([h for h in harmonics if h.get('isSignificant', False)]),
        'fixedFrequencyPeaks': fixed_freq_peaks,
        'severity': severity,
        'diagnosis': diagnosis,
        # Include processing metadata
        'processingInfo': {
            'cutoffFrequency': cutoff,
            'calibrationValue': calibration_value,
            'fmax': fmax,
            'signalProcessing': 'velocity_convert_with_butterworth'
        }
    }
    
    # Sanitize to ensure JSON serializability (handle any nan/inf values)
    return sanitize_dict(result)

