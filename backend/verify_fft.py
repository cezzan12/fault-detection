"""
FFT Verification Script - Compare our FFT output with raw data

This script fetches real vibration data from the API and performs FFT analysis,
allowing you to verify the calculations are correct.
"""
import httpx
import numpy as np
import json
from app.services.fft_analysis import perform_complete_analysis

def verify_fft_analysis():
    # Fetch real data from API
    url = 'https://srcapiv2.aams.io/AAMS/AI/Data'
    
    # Use the bearing ID from the screenshot
    payload = {
        'machineId': '664dbd9a5c3f971b7253a13f',
        'bearingLocationId': '664dbdab5c3f971b7253a147',
        'Axis_Id': 'H-Axis',
        'type': 'OFFLINE',
        'Analytics_Types': 'MF'
    }
    
    print("=" * 60)
    print("FFT VERIFICATION REPORT")
    print("=" * 60)
    
    print("\n1. FETCHING DATA FROM EXTERNAL API...")
    response = httpx.post(url, json=payload, timeout=30)
    data = response.json()
    
    rpm = float(data['rpm'])
    sr = float(data['SR'])
    raw_data = [float(x) for x in data['rawData']]
    
    print(f"   - RPM from API: {rpm}")
    print(f"   - Sample Rate: {sr} Hz")
    print(f"   - Data Points: {len(raw_data)}")
    print(f"   - Duration: {len(raw_data)/sr:.2f} seconds")
    
    # Calculate expected running frequency
    running_freq = rpm / 60.0
    print(f"\n2. RUNNING FREQUENCY CALCULATION")
    print(f"   - Formula: RPM / 60 = {rpm} / 60 = {running_freq:.2f} Hz")
    
    # Perform FFT analysis
    print("\n3. PERFORMING FFT ANALYSIS...")
    result = perform_complete_analysis(
        raw_data=raw_data,
        sample_rate=sr,
        rpm=rpm,
        axis='H',
        machine_class='II'
    )
    
    print(f"\n4. RESULTS")
    print(f"   - Running Frequency: {result['runningFrequency']} Hz")
    print(f"   - Peak at 1x: {result['peakAt1x']['frequency']:.2f} Hz, Amplitude: {result['peakAt1x']['amplitude']:.4f} mm/s")
    
    print(f"\n5. HARMONIC ANALYSIS")
    print(f"   - Significant Harmonics Count: {result['harmonicCount']}")
    print("\n   | Harmonic | Target (Hz) | Detected (Hz) | Amplitude |")
    print("   |----------|-------------|---------------|-----------|")
    for h in result['harmonics'][:5]:
        marker = "**" if h['isSignificant'] else "  "
        print(f"   | {h['label']:^8} | {h['targetFrequency']:^11.1f} | {h['detectedFrequency']:^13.1f} | {h['amplitude']:.4f}{marker} |")
    
    print(f"\n6. ISO 10816-3 SEVERITY")
    severity = result['severity']
    print(f"   - Zone: {severity['zone']} ({severity['label']})")
    print(f"   - Velocity RMS: {severity['velocityRMS']:.4f} mm/s")
    print(f"   - Machine Class: {severity['machineClass']}")
    print(f"   - Thresholds: A<={severity['thresholds']['A']}, B<={severity['thresholds']['B']}, C<={severity['thresholds']['C']}")
    
    print(f"\n7. FAULT DIAGNOSIS")
    diagnosis = result['diagnosis']
    print(f"   - Fault Type: {diagnosis['faultType']}")
    print(f"   - Confidence: {diagnosis['confidence']}")
    print(f"   - Evidence:")
    for e in diagnosis['evidence']:
        print(f"     • {e}")
    print(f"   - Recommendation: {diagnosis['action']}")
    
    # Manual verification of FFT
    print("\n" + "=" * 60)
    print("MANUAL FFT VERIFICATION")
    print("=" * 60)
    
    # Do our own FFT to compare
    n = len(raw_data)
    window = np.hanning(n)
    windowed = np.array(raw_data) * window
    fft_result = np.fft.rfft(windowed)
    freqs = np.fft.rfftfreq(n, d=1.0/sr)
    amplitudes = np.abs(fft_result) / n * 2
    
    # Find peak at 1x running frequency (±5%)
    lower = running_freq * 0.95
    upper = running_freq * 1.05
    mask = (freqs >= lower) & (freqs <= upper)
    band_freqs = freqs[mask]
    band_amps = amplitudes[mask]
    peak_idx = np.argmax(band_amps)
    
    print(f"\n   Manual FFT Peak at 1x:")
    print(f"   - Peak Frequency: {band_freqs[peak_idx]:.2f} Hz")
    print(f"   - Peak Amplitude: {band_amps[peak_idx]:.4f} mm/s")
    print(f"\n   ✓ Matches our analysis: {'YES' if abs(band_freqs[peak_idx] - result['peakAt1x']['frequency']) < 0.5 else 'NO'}")
    
    print("\n" + "=" * 60)
    print("VERIFICATION COMPLETE")
    print("=" * 60)

if __name__ == "__main__":
    verify_fft_analysis()
