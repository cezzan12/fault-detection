import math
import numpy as np
from scipy import signal
import scipy.integrate

# Handle scipy version compatibility
try:
    from scipy.integrate import cumulative_trapezoid
except ImportError:
    from scipy.integrate import cumtrapz as cumulative_trapezoid

def butter_highpass(cutoff, fs, order=2):
    nyq = 0.5 * fs
    normal_cutoff = cutoff / nyq
    b, a = signal.butter(order, normal_cutoff, btype='highpass', analog=False)
    return b, a

def butter_highpass_filter(data, cutoff, fs, order=2):
    b, a = butter_highpass(cutoff, fs, order=order)
    y = signal.filtfilt(b, a, data)
    return y

def FFT(temp):
  N = len(temp)
  yf = np.fft.fft(temp)
  yf=2.0/N * np.abs(yf[:N//2])
  yf[0]=0
  return yf

def hann_data(data):
    window = signal.windows.hann(len(data))
    TWS_VALUE = data * window
    return TWS_VALUE

def Velocity_Convert_24_DEMO(rawData, SR, RPM, cutoff, Order, fmax = None,floorNoiseThresholdPercentage = None,floorNoiseAttenuationFactor = None, highResolution = 1, calibrationValue = 1):

    if 40000 < len(rawData) < 50000:
        overlappingPercentage = 60
    else:
        overlappingPercentage = 80
    
    if highResolution > 1:
        blockSize = int(20000 * (highResolution/2))
    else:
        blockSize = 20000
    
    velocity_Timeseries_mms2 = np.array(rawData) * 9807
    N = len(velocity_Timeseries_mms2[0:blockSize])
    time_step = 1 / SR
    time = np.linspace(0.0, N*time_step, N)

    velocity_Timeseries_mms2 = velocity_Timeseries_mms2 - np.mean(velocity_Timeseries_mms2)
    velocity_Timeseries = cumulative_trapezoid(velocity_Timeseries_mms2, x=np.linspace(0.0, len(velocity_Timeseries_mms2)*time_step, len(velocity_Timeseries_mms2)), initial=0)

    rms_cutoff_value = max((RPM/60) * 0.6, 4)

    rms_cutoff_value = math.ceil(rms_cutoff_value)
    # rms_cutoff_value = max(rms_cutoff_value, cutoff)
    rms_cutoff_value  = cutoff

    final_velocity_Timeseries = butter_highpass_filter(velocity_Timeseries,rms_cutoff_value,10000,2)
    velocity_FFT_Data_list = []
    for i in range(4):
        start = int(i * (1 - (overlappingPercentage / 100)) * blockSize)
        end = start + blockSize

        velocity_Timeseries_i = cumulative_trapezoid(velocity_Timeseries_mms2[start:end], x=time, initial=0)
        velocity_Timeseries_i = butter_highpass_filter(velocity_Timeseries_i, rms_cutoff_value, 10000, 2 )
        velocity_FFT_Data_i = ((FFT(hann_data(velocity_Timeseries_i)))) * 2
        velocity_FFT_Data_list.append(velocity_FFT_Data_i)
        
    velocity_FFT_Data = sum(velocity_FFT_Data_list) / len(velocity_FFT_Data_list)

    velocity_FFT_X_Data = np.linspace(0.0, SR / 2, num=int(len(velocity_FFT_Data)))
    if floorNoiseThresholdPercentage not in (None, 0) and floorNoiseAttenuationFactor not in (None, 0):
        velocity_FFT_Data = np.where(velocity_FFT_Data < (np.max(velocity_FFT_Data) * floorNoiseThresholdPercentage), velocity_FFT_Data / floorNoiseAttenuationFactor, velocity_FFT_Data)
    else:
        velocity_FFT_Data = np.where(velocity_FFT_Data < (np.max(velocity_FFT_Data)*0.05), velocity_FFT_Data/1.1, velocity_FFT_Data)
        
    velocity_FFT_Data[:int(np.where(velocity_FFT_X_Data > rms_cutoff_value)[0][0])] *= 0.2
    
    velocity_FFT_Data[:int(np.where(velocity_FFT_X_Data > (rms_cutoff_value * .75))[0][0])] *= 0.05

    Velocity_FFT_Data = np.round(velocity_FFT_Data,8)
    Velocity_FFT_Data = Velocity_FFT_Data * calibrationValue

    if fmax != None:
        filtered_indices = velocity_FFT_X_Data < fmax
        Final_Velocity_FFT_Data = list(zip(velocity_FFT_X_Data[filtered_indices], Velocity_FFT_Data[filtered_indices]))

    else:
        Final_Velocity_FFT_Data = list(zip(velocity_FFT_X_Data,Velocity_FFT_Data))

    v1 = (len(final_velocity_Timeseries)/SR) / len(final_velocity_Timeseries)
    final_Timeseries_Data = np.round(final_velocity_Timeseries,8)
    Final_Velocity_Temp_Data = [ [(i * v1), final_Timeseries_Data[i]] for i in range(len(final_Timeseries_Data))]

    return { "SR": SR, "twf_min": Final_Velocity_Temp_Data[0][0], "twf_max": Final_Velocity_Temp_Data[-1][0], "Timeseries": Final_Velocity_Temp_Data, "fft_min": Final_Velocity_FFT_Data[0][0], "fft_max": Final_Velocity_FFT_Data[-1][0], "FFT": Final_Velocity_FFT_Data }  

def Acceleration_Convert_32_DEMO(Data, SR, fmax = None):
    Acceleration_Timeseries_Data =  np.array(Data)

    Filter_Cutoff = 10
    Filter_Order = 4

    first_filter_data = butter_highpass_filter(Acceleration_Timeseries_Data, Filter_Cutoff, SR, Filter_Order)
    Acceleration_FFT_Data = (FFT(hann_data(first_filter_data)) * 0.707) * 2.1

    Acceleration_FFT_X_Data = np.linspace(0.0, SR / 2, num=int(len(Acceleration_FFT_Data)))
    
    if fmax != None:
        filtered_indices = Acceleration_FFT_X_Data < fmax
        Final_Acceleration_FFT_Data = list(zip(Acceleration_FFT_X_Data[filtered_indices], Acceleration_FFT_Data[filtered_indices]))

    else:
        Final_Acceleration_FFT_Data = list(zip(Acceleration_FFT_X_Data,Acceleration_FFT_Data))

    Acceleration_Timeseries_Data = Acceleration_Timeseries_Data[int(len(Acceleration_Timeseries_Data)*0.1):]

    v1 = (len(Acceleration_Timeseries_Data)/SR) / len(Acceleration_Timeseries_Data)
    Temp_Acceleration_Temp = Acceleration_Timeseries_Data
    Final_Acceleration_Timeseries_Data = [[i * v1, Acceleration_Timeseries_Data[i]] for i in range(len(Temp_Acceleration_Temp))]

    return { "SR": SR, "twf_min": Final_Acceleration_Timeseries_Data[0][0], "twf_max": Final_Acceleration_Timeseries_Data[-1][0], "Timeseries": Final_Acceleration_Timeseries_Data, "fft_min": Final_Acceleration_FFT_Data[0][0], "fft_max": Final_Acceleration_FFT_Data[-1][0], "FFT": Final_Acceleration_FFT_Data }
