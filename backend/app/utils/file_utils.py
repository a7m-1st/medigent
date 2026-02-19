"""File system utilities."""

import base64
import logging
import os
import re
import uuid
from pathlib import Path

from app.component.environment import env
from app.model.chat import Chat

logger = logging.getLogger("file_utils")


def get_working_directory(options: Chat, task_lock=None) -> str:
    """
    Get the correct working directory for file operations.
    First checks if there's an updated path from improve API call,
    then falls back to environment variable or default path.
    """
    if not task_lock:
        from app.service.task import get_task_lock_if_exists

        task_lock = get_task_lock_if_exists(options.project_id)

    if (
        task_lock
        and hasattr(task_lock, "new_folder_path")
        and task_lock.new_folder_path
    ):
        return str(task_lock.new_folder_path)
    else:
        return env("file_save_path", options.file_save_path())


def is_base64_image(data: str) -> bool:
    """Check if a string is a base64 encoded image data URL."""
    return data.startswith("data:image/")


def save_base64_image(
    base64_data: str,
    save_dir: str,
    filename_prefix: str = "upload",
) -> str:
    """
    Save a base64 encoded image to a file.

    Args:
        base64_data: Base64 data URL (e.g., "data:image/png;base64,iVBORw0...")
        save_dir: Directory to save the image
        filename_prefix: Prefix for the generated filename

    Returns:
        Absolute path to the saved image file

    Raises:
        ValueError: If the data is not a valid base64 image
    """
    # Parse the data URL
    match = re.match(r"data:image/(\w+);base64,(.+)", base64_data)
    if not match:
        raise ValueError("Invalid base64 image data URL")

    image_format = match.group(1).lower()
    image_data = match.group(2)

    # Normalize format extension
    ext_map = {"jpeg": "jpg", "png": "png", "gif": "gif", "webp": "webp"}
    ext = ext_map.get(image_format, image_format)

    # Generate unique filename
    unique_id = uuid.uuid4().hex[:8]
    filename = f"{filename_prefix}_{unique_id}.{ext}"

    # Ensure save directory exists
    save_path = Path(save_dir)
    save_path.mkdir(parents=True, exist_ok=True)

    # Decode and save
    file_path = save_path / filename
    try:
        decoded_data = base64.b64decode(image_data)
        with open(file_path, "wb") as f:
            f.write(decoded_data)

        logger.info(f"Saved image: {file_path} ({len(decoded_data)} bytes)")
        return str(file_path.absolute())
    except Exception as e:
        logger.error(f"Failed to save image: {e}")
        raise ValueError(f"Failed to decode and save image: {e}")


def process_attaches(
    attaches: list[str],
    save_dir: str,
) -> list[str]:
    """
    Process a list of attachments, converting base64 images to file paths.

    Args:
        attaches: List of file paths or base64 data URLs
        save_dir: Directory to save converted images

    Returns:
        List of file paths (base64 images are saved and converted to paths)
    """
    processed = []
    for i, attach in enumerate(attaches):
        if is_base64_image(attach):
            try:
                file_path = save_base64_image(
                    attach,
                    save_dir,
                    filename_prefix=f"image_{i+1}",
                )
                processed.append(file_path)
            except ValueError as e:
                logger.warning(f"Skipping invalid base64 image: {e}")
        else:
            # Already a file path, use as-is
            processed.append(attach)

    return processed