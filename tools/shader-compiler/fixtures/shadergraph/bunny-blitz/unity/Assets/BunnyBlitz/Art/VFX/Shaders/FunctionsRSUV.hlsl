#include "HelpersRSUV.hlsl"

void GetTimer_float(out float hitTime, out bool isDead, out bool isSpawned)
{
    uint data = GetData();
    hitTime = DecodeBitToInt(data, 0, 24) / 1000;
    isDead = GetBit(data, 24);
    isSpawned = GetBit(data, 25);
}


