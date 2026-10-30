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
            "preview_url": output.get("rendered_image_url"),
            "credits_consumed": data.get("credits_consumed"),
        }

    def rig(self, task_id):
        task_id = str(task_id or "").strip()
        if not task_id.startswith("task_") or len(task_id) > 160:
            raise TripoError("Invalid Tripo task ID.", 400)
        body = {
            "input": task_id,
            "model": "v1.0-20240301",
            "rig_type": "biped",
            "spec": "tripo",
            "out_format": "glb",
        }
        try:
            response = requests.post(BASE_URL + "/animations/rig",
                                     headers=self._headers(json_body=True), json=body, timeout=self.timeout)
        except requests.RequestException as exc:
            raise TripoError("Could not start rigging: " + str(exc)[:160])
        data = self._data(response)
        new_task_id = data.get("task_id")
        if not new_task_id:
            raise TripoError("Tripo did not return a rigging task ID.")
        return {"task_id": new_task_id}
