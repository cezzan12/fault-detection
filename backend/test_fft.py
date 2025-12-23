"""Test script for FFT analysis"""
import httpx
from app.services.fft_analysis import perform_complete_analysis

# Fetch real data from API
url = 'https://srcapiv2.aams.io/AAMS/AI/Data'
payload = {
    'machineId': '664dbd9a5c3f971b7253a13f',
    'bearingLocationId': '664dbdab5c3f971b7253a147',
    'Axis_Id': 'H-Axis',
    'type': 'OFFLINE',
    'Analytics_Types': 'MF'
}

print("Fetching data from API...")
response = httpx.post(url, json=payload, timeout=30)
data = response.json()
print(f"RPM: {data.get('rpm')}")
print(f"SR: {data.get('SR')}")
print(f"rawData length: {len(data.get('rawData', []))}")

# Convert all values to float
raw_data = [float(x) for x in data['rawData']]
print(f"Converted data length: {len(raw_data)}")
print(f"First value: {raw_data[0]}, type: {type(raw_data[0])}")

# Perform analysis
print("\nPerforming FFT analysis...")
try:
    result = perform_complete_analysis(
        raw_data=raw_data,
        sample_rate=float(data['SR']),
        rpm=float(data['rpm']),
        axis='H',
        machine_class='II'
    )

    print(f"\nAnalysis Result:")
    print(f"  Running Frequency: {result['runningFrequency']} Hz")
    print(f"  Peak at 1x: {result['peakAt1x']}")
    print(f"  Harmonic Count: {result['harmonicCount']}")
    print(f"  Severity Zone: {result['severity']['zone']} ({result['severity']['label']})")
    print(f"  Diagnosis: {result['diagnosis']['faultType']} - {result['diagnosis']['confidence']}")
    print("\nSUCCESS!")
except Exception as e:
    print(f"\nERROR: {e}")
    import traceback
    traceback.print_exc()
