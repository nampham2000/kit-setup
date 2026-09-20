# Linear HDR target

For a source HDR camera with no tone mapping, accumulate particles into RGBA16F and encode sRGB once at presentation. Cocos Creator 3.8.8 RenderTexture._initWindow overwrites passInfo color formats with device.swapchainFormat. A requested RGBA16F texture can therefore actually be RGBA8, producing coarse bands before sRGB encoding.

Call initializeUnityLinearTarget before attaching cameras or materials. It rebuilds the existing unattached RenderWindow with the requested pass format and fails if the GPU format is not RGBA16F. Normal RenderTexture resize preserves that attachment format. Do not change global swapchainFormat or alter particle opacity. Runtime acceptance must inspect GPU format and fractional linear pixel values, including after resize.
