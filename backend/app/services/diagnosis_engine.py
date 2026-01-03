"""
Fault Diagnosis Engine

Excel-based fault diagnosis rules for machine vibration analysis.
This module ONLY READS existing FFT outputs - it does NOT modify FFT calculations.

Based on: "Common Defects in all Machine Components" Excel reference.
"""

from typing import Dict, List, Optional, Any
import logging

# ==========================================
# FAULT DEFINITIONS FROM EXCEL
# ==========================================

FAULT_DEFINITIONS = {
    'Misalignment': {
        'description': 'High vibration in Horizontal and Axial; Prominent peaks at 1X, 2X, 3X',
        'recommendation': 'Check the coupling and achieve precision alignment between motor and pump/Fan/Gearbox/Compressor'
    },
    'Coupling Defects': {
        'description': 'High vibration in both drive and driven; Major 3X, 4X or Multiple harmonics of 1X',
        'recommendation': 'Check the coupling for cracks, wear, or looseness and achieve precision alignment'
    },
    'Bearing Outer Race Defects': {
        'description': 'Non-integer peak (Not matches with 1X Order); BPFO frequency rise (3.6X-5.2X range)',
        'recommendation': 'Defects have been identified in the bearing. Inspect and replace the bearing'
    },
    'Bearing Inner Race Defects': {
        'description': 'Non-integer peak (Not matches with 1X Order); BPFI frequency rise (6X-10X range)',
        'recommendation': 'Defects have been identified in the bearing. Inspect and replace the bearing'
    },
    'Bearing Ball Spin Defects': {
        'description': 'Non-integer peak (Not matches with 1X Order); BSF frequency rise (7X-10X range)',
        'recommendation': 'Defects have been identified in the bearing. Inspect and replace the bearing'
    },
    'Bearing Cage Defects': {
        'description': 'Non-integer peak (Not matches with 1X Order); FTF frequency rise (Below 1X, 0.6X-0.9X)',
        'recommendation': 'Defects have been identified in the bearing. Inspect and replace the bearing'
    },
    'Soft Foot': {
        'description': 'Major vibrations in Horizontal or Axial direction; 1X or 2X dominant',
        'recommendation': 'Check the motor base for soft foot issues and ensure foundation and baseplate are level'
    },
    'Bearing Looseness': {
        'description': '0.5X present; Multiple harmonics of 1X order',
        'recommendation': 'Check the pump bearing clearances and the interference fit of the bearings with housings'
    },
    'Bearing Fitment': {
        'description': '2X dominant; Major amplitude in 2X order of running speed',
        'recommendation': 'Check the pump bearing clearances and the interference fit of the bearings with housings'
    },
    'Unbalance': {
        'description': 'Dominant 1X with low harmonic content',
        'recommendation': 'Schedule balancing service for the rotating component'
    },
    'High Vibration': {
        'description': 'Overall vibration level exceeds acceptable limits',
        'recommendation': 'Immediate inspection required - check all mechanical components'
    },
    'Normal': {
        'description': 'No significant fault indicators detected',
        'recommendation': 'Continue regular monitoring'
    }
}

# Tolerance for frequency matching (±2%)
FREQUENCY_TOLERANCE = 0.02


def find_peak_at_multiple(harmonics: List[Dict], multiplier: float, running_freq: float, 
                          tolerance: float = FREQUENCY_TOLERANCE) -> Optional[Dict]:
    """Find a harmonic peak at a specific multiple of running frequency."""
    target_freq = multiplier * running_freq
    low_bound = target_freq * (1 - tolerance)
    high_bound = target_freq * (1 + tolerance)
    
    for h in harmonics:
        freq = h.get('frequency', h.get('detectedFrequency', 0))
        if low_bound <= freq <= high_bound:
            return h
    
    return None


def get_amplitude_at_multiple(harmonics: List[Dict], multiplier: float, running_freq: float,
                              tolerance: float = FREQUENCY_TOLERANCE) -> float:
    """Get amplitude at a specific multiple of running frequency."""
    peak = find_peak_at_multiple(harmonics, multiplier, running_freq, tolerance)
    return peak.get('amplitude', 0) if peak else 0


def get_max_amplitude(harmonics: List[Dict]) -> float:
    """Get the maximum amplitude from harmonics list."""
    if not harmonics:
        return 0
    return max(h.get('amplitude', 0) for h in harmonics)


def perform_enhanced_diagnosis(fft_spectrum: List[Dict],
                               rpm: float,
                               harmonics: List[Dict],
                               running_freq: float,
                               axis: str = 'V',
                               axis_data: Optional[Dict] = None,
                               bearing_defect_freqs: Optional[Dict] = None,
                               fixed_freq_peaks: Optional[List[Dict]] = None,
                               severity_zone: Optional[str] = None,
                               velocity_rms: Optional[float] = None) -> Dict[str, Any]:
    """
    Perform enhanced fault diagnosis using Excel-based rules.
    
    Uses RELATIVE amplitude comparisons (ratios between harmonics) rather than
    absolute thresholds, making it work with any data scale.
    """
    
    # ================== PRE-CHECK ==================
    missing_data = []
    
    if not rpm or rpm <= 0:
        missing_data.append('RPM')
    
    if not harmonics:
        missing_data.append('FFT peak data')
    
    if missing_data:
        return {
            'fault': 'Diagnosis unavailable',
            'confidence': 'Low',
            'evidence': [f'Required data missing: {", ".join(missing_data)}'],
            'recommendation': 'Ensure all required data is available for diagnosis'
        }
    
    # Calculate running frequency if not provided
    if not running_freq or running_freq <= 0:
        running_freq = rpm / 60.0
    
    # Get amplitudes at key harmonics
    amp_05x = get_amplitude_at_multiple(harmonics, 0.5, running_freq)
    amp_1x = get_amplitude_at_multiple(harmonics, 1.0, running_freq)
    amp_2x = get_amplitude_at_multiple(harmonics, 2.0, running_freq)
    amp_3x = get_amplitude_at_multiple(harmonics, 3.0, running_freq)
    amp_4x = get_amplitude_at_multiple(harmonics, 4.0, running_freq)
    
    max_amp = get_max_amplitude(harmonics)
    
    # Count significant harmonics (>10% of max amplitude)
    significant_threshold = max_amp * 0.1 if max_amp > 0 else 0.01
    significant_harmonics = [h for h in harmonics if h.get('amplitude', 0) > significant_threshold]
    harmonic_count = len(significant_harmonics)
    
    # ================== SCORING FOR EACH FAULT TYPE ==================
    fault_scores = {}
    evidence_lists = {}
    
    # --- 1. UNBALANCE: Dominant 1X, low harmonic content ---
    score_unbalance = 0
    evidence_unbalance = []
    
    # 1X should be dominant (highest or near highest)
    if amp_1x >= max_amp * 0.7:
        score_unbalance += 3
        evidence_unbalance.append(f'Dominant 1× running frequency peak ({amp_1x:.3f} mm/s)')
    
    # Low harmonic content (2X and 3X are small relative to 1X)
    if amp_1x > 0:
        if amp_2x < amp_1x * 0.35 and amp_3x < amp_1x * 0.25:
            score_unbalance += 2
            evidence_unbalance.append('Low harmonic content')
    
    fault_scores['Unbalance'] = score_unbalance
    evidence_lists['Unbalance'] = evidence_unbalance
    
    # --- 2. MISALIGNMENT: Significant 1X, 2X, 3X pattern ---
    score_misalign = 0
    evidence_misalign = []
    
    # 2X should be significant relative to 1X (>30%)
    if amp_1x > 0 and amp_2x > amp_1x * 0.30:
        score_misalign += 3
        evidence_misalign.append(f'Significant 2× harmonic ({amp_2x:.3f} mm/s, {(amp_2x/amp_1x*100):.0f}% of 1×)')
    
    # 3X present
    if amp_1x > 0 and amp_3x > amp_1x * 0.15:
        score_misalign += 2
        evidence_misalign.append(f'Elevated 3× harmonic ({amp_3x:.3f} mm/s)')
    
    fault_scores['Misalignment'] = score_misalign
    evidence_lists['Misalignment'] = evidence_misalign
    
    # --- 3. COUPLING DEFECTS: Strong 3X or 4X, multiple harmonics ---
    score_coupling = 0
    evidence_coupling = []
    
    # Strong 3X (>50% of 1X)
    if amp_1x > 0 and amp_3x > amp_1x * 0.50:
        score_coupling += 3
        evidence_coupling.append(f'Strong 3× harmonic ({amp_3x:.3f} mm/s)')
    
    # Strong 4X (>40% of 1X)
    if amp_1x > 0 and amp_4x > amp_1x * 0.40:
        score_coupling += 3
        evidence_coupling.append(f'Strong 4× harmonic ({amp_4x:.3f} mm/s)')
    
    # Multiple harmonics
    if harmonic_count >= 4:
        score_coupling += 2
        evidence_coupling.append(f'Multiple harmonics detected ({harmonic_count})')
    
    fault_scores['Coupling Defects'] = score_coupling
    evidence_lists['Coupling Defects'] = evidence_coupling
    
    # --- 4. BEARING LOOSENESS: 0.5X present, multiple harmonics ---
    score_looseness = 0
    evidence_looseness = []
    
    # 0.5X subharmonic present
    if amp_05x > max_amp * 0.1:
        score_looseness += 4
        evidence_looseness.append(f'0.5× subharmonic detected ({amp_05x:.3f} mm/s)')
    
    # Multiple harmonics
    if harmonic_count >= 4:
        score_looseness += 2
        evidence_looseness.append(f'Multiple harmonics of 1× order ({harmonic_count})')
    
    fault_scores['Bearing Looseness'] = score_looseness
    evidence_lists['Bearing Looseness'] = evidence_looseness
    
    # --- 5. BEARING FITMENT: 2X dominant (exceeds 1X) ---
    score_fitment = 0
    evidence_fitment = []
    
    # 2X exceeds or equals 1X
    if amp_2x > amp_1x * 0.90:
        score_fitment += 4
        evidence_fitment.append(f'2× dominant ({amp_2x:.3f} mm/s vs 1×: {amp_1x:.3f} mm/s)')
    
    # 2X is the highest peak
    if amp_2x >= max_amp * 0.9:
        score_fitment += 2
        evidence_fitment.append('2× is the dominant peak')
    
    fault_scores['Bearing Fitment'] = score_fitment
    evidence_lists['Bearing Fitment'] = evidence_fitment
    
    # --- 6. HIGH VIBRATION: Based on severity zone ---
    score_high_vib = 0
    evidence_high_vib = []
    
    # If severity zone is C or D, there's definitely a problem
    if severity_zone in ['C', 'D'] or (velocity_rms and velocity_rms > 2.8):
        score_high_vib += 3
        if velocity_rms:
            evidence_high_vib.append(f'High overall vibration level ({velocity_rms:.2f} mm/s RMS)')
        else:
            evidence_high_vib.append(f'Vibration in {severity_zone} zone (elevated)')
    
    fault_scores['High Vibration'] = score_high_vib
    evidence_lists['High Vibration'] = evidence_high_vib
    
    # ================== SELECT BEST FAULT ==================
    # Filter to only detected faults (score >= 4) or with evidence
    detected_faults = {
        name: score for name, score in fault_scores.items() 
        if score >= 4
    }
    
    # If no specific fault detected but high vibration, use that
    if not detected_faults and fault_scores.get('High Vibration', 0) >= 3:
        detected_faults['High Vibration'] = fault_scores['High Vibration']
    
    # If still nothing detected
    if not detected_faults:
        # Check if we should really call it normal
        if severity_zone in ['C', 'D']:
            # Something is wrong even if no specific pattern
            return {
                'fault': 'High Vibration',
                'confidence': 'Medium',
                'evidence': [f'Overall vibration level elevated (Zone {severity_zone})', 
                             'No specific fault pattern identified'],
                'recommendation': 'Detailed inspection recommended to identify root cause'
            }
        return {
            'fault': 'Normal',
            'confidence': 'High',
            'evidence': ['No significant fault indicators detected from available data'],
            'recommendation': FAULT_DEFINITIONS['Normal']['recommendation']
        }
    
    # Select fault with highest score
    best_fault_name = max(detected_faults, key=detected_faults.get)
    best_score = detected_faults[best_fault_name]
    
    # ================== DETERMINE CONFIDENCE ==================
    if best_score >= 6:
        confidence = 'High'
    elif best_score >= 4:
        confidence = 'Medium'
    else:
        confidence = 'Low'
    
    # Boost confidence if severity zone also indicates problem
    if severity_zone in ['C', 'D'] and confidence == 'Medium':
        confidence = 'High'
    
    # ================== BUILD OUTPUT ==================
    fault_def = FAULT_DEFINITIONS.get(best_fault_name, FAULT_DEFINITIONS['Normal'])
    evidence = evidence_lists.get(best_fault_name, [])
    
    # Add severity info to evidence if relevant
    if severity_zone in ['C', 'D'] and velocity_rms:
        evidence.append(f'Zone {severity_zone} vibration level ({velocity_rms:.2f} mm/s RMS)')
    
    return {
        'fault': best_fault_name,
        'confidence': confidence,
        'evidence': evidence if evidence else ['Fault pattern detected'],
        'recommendation': fault_def['recommendation'],
        'harmonicCount': harmonic_count,
        'allFaults': {
            name: {'score': score, 'detected': score >= 4}
            for name, score in fault_scores.items()
        }
    }
