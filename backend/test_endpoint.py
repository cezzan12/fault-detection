"""Test the API endpoint directly"""
import asyncio
import sys
sys.path.insert(0, '.')

async def test_endpoint():
    from app.routers.machines import get_fft_analysis
    
    print("Testing FFT analysis endpoint...")
    try:
        result = await get_fft_analysis(
            machine_id="664dbd9a5c3f971b7253a13f",
            bearing_id="664dbdab5c3f971b7253a147",
            data_type="OFFLINE",
            machine_class="II"
        )
        print(f"Success: {result.get('success')}")
        print(f"RPM: {result.get('rpm')}")
        print(f"Running Frequency: {result.get('runningFrequency')}")
        
        # Check axis data
        for axis, data in result.get('axisData', {}).items():
            print(f"  {axis}: available={data.get('available')}, error={data.get('error', 'None')}")
        
        print(f"Overall Severity: {result.get('overallSeverity')}")
        print(f"Overall Diagnosis: {result.get('overallDiagnosis')}")
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()

asyncio.run(test_endpoint())
