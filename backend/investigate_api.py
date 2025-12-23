"""Extract velocity values from BearingLocation API"""
import httpx
import json

url = "https://srcapiv2.aams.io/AAMS/AI/BearingLocation"
payload = {"machineId": "664dbfaf5c3f971b7253a319"}

response = httpx.post(url, json=payload, timeout=30)
data = response.json()

bearings = data if isinstance(data, list) else data.get('data', [])

print("BEARING VELOCITY VALUES:")
print("-"*60)

for b in bearings:
    bearing_id = b.get('_id', 'N/A')
    status = b.get('statusName', 'N/A')
    velocity = b.get('velocity', {})
    
    # Extract velocity values
    if isinstance(velocity, dict):
        # Look for H, V, A keys in velocity
        h_vel = velocity.get('H')
        v_vel = velocity.get('V')  
        a_vel = velocity.get('A')
        
        # Or look for overall/rms
        overall = velocity.get('overall') or velocity.get('rms')
        
        print(f"\nBearing: {bearing_id[-8:]}")
        print(f"  Status: {status}")
        print(f"  H-Axis velocity: {h_vel}")
        print(f"  V-Axis velocity: {v_vel}")
        print(f"  A-Axis velocity: {a_vel}")
        print(f"  Overall: {overall}")
        
        # Print all velocity keys
        print(f"  Velocity keys: {list(velocity.keys())[:10]}...")
