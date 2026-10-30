"""Secure Tripo v3 adapter for user-consented multi-view avatar creation.

Images are streamed from Flask to Tripo and are never written to COSMIC's disk.
The API key is read only from the server environment.
"""
import os
import requests


BASE_URL = "https://openapi.tripo3d.ai/v3"


class TripoError(Exception):
    def __init__(self, message, status=502):
        super().__init__(message)
        self.status = status


class TripoService:
    def __init__(self):
        self.api_key = os.getenv("TRIPO_API_KEY", "").strip()
        self.timeout = (15, 90)

    @property
    def configured(self):
        return bool(self.api_key)

    def _headers(self, json_body=False):
        if not self.configured:
            raise TripoError("TRIPO_API_KEY is not configured on the COSMIC backend.", 503)
        headers = {"Authorization": "Bearer " + self.api_key}
        if json_body:
            headers["Content-Type"] = "application/json"
        return headers

    @staticmethod
    def _data(response):
        try:
            payload = response.json()
        except ValueError:
            raise TripoError("Tripo returned a non-JSON response.")
        if not response.ok or payload.get("code", 0) != 0:
            message = payload.get("message") or payload.get("suggestion") or ("HTTP " + str(response.status_code))
            raise TripoError("Tripo API: " + str(message)[:240], 502)
        return payload.get("data") or {}

    def _upload(self, view, upload):
        if not upload or not getattr(upload, "filename", ""):
            return None
        filename = upload.filename.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
        content_type = (upload.mimetype or "").lower()
        if content_type not in ("image/jpeg", "image/png", "image/webp"):
            raise TripoError(view + " image must be JPEG, PNG, or WebP.", 400)
        raw = upload.read()
        upload.stream.seek(0)
        if not raw or len(raw) > 20 * 1024 * 1024:
            raise TripoError(view + " image is empty or exceeds 20 MB.", 400)
        files = {"file": (filename or (view + ".jpg"), raw, content_type)}
        try:
            response = requests.post(BASE_URL + "/files", headers=self._headers(), files=files, timeout=self.timeout)
        except requests.RequestException as exc:
            raise TripoError("Could not upload " + view + " image to Tripo: " + str(exc)[:160])
        token = self._data(response).get("file_token")
        if not token:
            raise TripoError("Tripo did not return a file token for the " + view + " image.")
        return token


    def create_preset(self, preset_name):
        """Create a ready-made adult human or anime character from a controlled preset."""
        presets = {
            "hyderabad_man": (
                "Photorealistic full-body adult Hyderabadi Indian man, natural South Asian facial features, "
                "warm medium-brown skin, short neatly styled dark hair, subtle stubble, elegant modern "
                "charcoal kurta jacket and trousers, realistic hands and shoes, neutral A-pose with arms "
                "slightly away from torso, symmetrical anatomy, detailed skin and fabric PBR textures, "
                "studio soft lighting, isolated full-body character, no props, no text."
            ),
            "hyderabad_woman": (
                "Photorealistic full-body adult Hyderabadi Indian woman, natural South Asian facial features, "
                "warm medium-brown skin, dark hair, tasteful contemporary Indian outfit with realistic fabric "
                "folds, realistic hands and shoes, neutral A-pose with arms slightly away from torso, "
                "symmetrical anatomy, detailed skin and fabric PBR textures, studio soft lighting, "
                "isolated full-body character, no props, no text."
            ),
            "global_man": (
                "Photorealistic full-body adult male human character with natural balanced facial proportions, "
                "short dark hair, neutral contemporary clothing, realistic hands and shoes, neutral A-pose, "
                "symmetrical anatomy, detailed skin and fabric PBR textures, studio soft lighting, "
                "isolated full-body character, no props, no text."
            ),
            "global_woman": (
                "Photorealistic full-body adult female human character with natural balanced facial proportions, "
                "long dark hair, neutral contemporary clothing, realistic hands and shoes, neutral A-pose, "
                "symmetrical anatomy, detailed skin and fabric PBR textures, studio soft lighting, "
                "isolated full-body character, no props, no text."
            ),
            "anime_hero": (
                "High-quality full-body 3D anime-style adult male hero character, expressive stylized face, "
                "large anime eyes, carefully sculpted hair, detailed layered fantasy streetwear, realistic "
                "3D materials and fabric, clean stylized proportions, neutral A-pose, symmetrical anatomy, "
                "full body including hands and shoes, studio soft lighting, isolated character, no text."
            ),
            "anime_heroine": (
                "High-quality full-body 3D anime-style adult female heroine character, expressive stylized face, "
                "large anime eyes, carefully sculpted hair, detailed layered elegant outfit, realistic 3D "
                "materials and fabric, clean stylized proportions, neutral A-pose, symmetrical anatomy, "
                "full body including hands and shoes, studio soft lighting, isolated character, no text."
            ),
        }
        prompt = presets.get(str(preset_name or "").strip().lower())
        if not prompt:
            raise TripoError("Unknown character preset.", 400)
        body = {
            "prompt": prompt,
            "model": os.getenv("TRIPO_CHARACTER_MODEL", "v3.1-20260211"),
            "face_limit": int(os.getenv("TRIPO_CHARACTER_FACE_LIMIT", "30000")),
            "texture": True,
            "pbr": True,
            "texture_quality": "detailed",
            "geometry_quality": "detailed",
            "auto_size": True,
        }
        try:
            response = requests.post(
                BASE_URL + "/generation/text-to-model",
                headers=self._headers(json_body=True),
                json=body,
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise TripoError("Could not start character generation: " + str(exc)[:160])
        data = self._data(response)
        task_id = data.get("task_id")
        if not task_id:
            raise TripoError("Tripo did not return a character task ID.")
        return {"task_id": task_id, "preset": preset_name, "model": body["model"]}

    def rig_check(self, task_id):
        task_id = str(task_id or "").strip()
        if not task_id.startswith("task_") or len(task_id) > 160:
            raise TripoError("Invalid Tripo task ID.", 400)
        try:
            response = requests.post(
                BASE_URL + "/animations/rig-check",
                headers=self._headers(json_body=True),
                json={"input": task_id},
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise TripoError("Could not check model riggability: " + str(exc)[:160])
        data = self._data(response)
        check_task_id = data.get("task_id")
        if not check_task_id:
            raise TripoError("Tripo did not return a rig-check task ID.")
        return {"task_id": check_task_id}

    def create_multiview(self, files):
        if not self.configured:
            raise TripoError("3D creation is not configured. Add TRIPO_API_KEY to the backend .env file.", 503)
        view_names = ("front", "left", "back", "right")
        if not files.get("front"):
            raise TripoError("A front-view photo is required.", 400)
        present = [name for name in view_names if files.get(name) and getattr(files[name], "filename", "")]
        if len(present) < 2:
            raise TripoError("Upload at least two angles. Four angles (front, left, back, right) produce the best result.", 400)

        inputs = []
        for view in view_names:
            upload = files.get(view)
            if upload and getattr(upload, "filename", ""):
                token = self._upload(view, upload)
                inputs.append({view: token})

        body = {
            "inputs": inputs,
            "model": os.getenv("TRIPO_MODEL", "v3.1-20260211"),
            "texture": True,
            "pbr": True,
            "texture_quality": "detailed",
            "geometry_quality": "detailed",
            "texture_alignment": "original_image",
        }
        try:
            response = requests.post(BASE_URL + "/generation/multiview-to-model",
                                     headers=self._headers(json_body=True), json=body, timeout=self.timeout)
        except requests.RequestException as exc:
            raise TripoError("Could not start the 3D generation task: " + str(exc)[:160])
        data = self._data(response)
        task_id = data.get("task_id")
        if not task_id:
            raise TripoError("Tripo did not return a task ID.")
        return {"task_id": task_id, "views_uploaded": len(inputs), "model": body["model"]}

    def task(self, task_id):
        task_id = str(task_id or "").strip()
        if not task_id.startswith("task_") or len(task_id) > 160:
            raise TripoError("Invalid Tripo task ID.", 400)
        try:
            response = requests.get(BASE_URL + "/tasks/" + task_id, headers=self._headers(), timeout=self.timeout)
        except requests.RequestException as exc:
            raise TripoError("Could not check the 3D task: " + str(exc)[:160])
        data = self._data(response)
        output = data.get("output") or {}
        return {
            "task_id": data.get("task_id", task_id),
            "status": data.get("status", "unknown"),
            "progress": data.get("progress", 0),
            "error": data.get("error_message") or data.get("message"),
            "model_url": output.get("model_url"),
            "model_urls": output.get("model_urls"),
            "preview_url": output.get("rendered_image_url"),
            "riggable": output.get("riggable"),
            "rig_type": output.get("rig_type"),
            "credits_consumed": data.get("credits_consumed"),
        }

    def rig(self, task_id, rig_type="biped"):
        task_id = str(task_id or "").strip()
        if not task_id.startswith("task_") or len(task_id) > 160:
            raise TripoError("Invalid Tripo task ID.", 400)
        if rig_type != "biped":
            raise TripoError("COSMIC character rigging currently supports human biped models only.", 400)
        body = {
            "input": task_id,
            "model": "v1.0-20240301",
            "rig_type": rig_type,
            "spec": "tripo",
            "out_format": "glb",
        }
        try:
            response = requests.post(
                BASE_URL + "/animations/rig",
                headers=self._headers(json_body=True),
                json=body,
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise TripoError("Could not start rigging: " + str(exc)[:160])
        data = self._data(response)
        new_task_id = data.get("task_id")
        if not new_task_id:
            raise TripoError("Tripo did not return a rigging task ID.")
        return {"task_id": new_task_id, "rig_type": rig_type}
