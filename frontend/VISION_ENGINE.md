# COSMIC Vision Engine (browser module)

Open `/vision.html` on the COSMIC Flask server. This first module uses TensorFlow.js and the COCO-SSD Lite model for browser-side object detection. The model and TensorFlow.js are loaded from CDN on first launch; internet connectivity is needed to load them. Webcam permission is required.

Features: live camera selection, bounding boxes and labels, confidence display, selectable detections, optional Wikipedia summary lookup, browser-local searchable notes and manual profile labels.

Limitations: COCO-SSD recognizes its fixed training classes, not arbitrary objects; model accuracy and speed depend on device and lighting. This module is not a biometric face recognition system. It does not automatically identify people by face. Profiles are manual labels only. This module has not been verified on a physical smart board yet.
