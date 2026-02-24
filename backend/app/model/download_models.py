import os
from pathlib import Path

from dotenv import load_dotenv
from huggingface_hub import hf_hub_download


def main():
    project_root = Path(__file__).parent.parent.parent.parent
    load_dotenv(project_root / "model" / ".env")

    hf_token = os.getenv("HF_TOKEN")
    if not hf_token:
        raise ValueError("HF_TOKEN not found in model/.env")

    repo_id = "unsloth/medgemma-4b-it-GGUF"
    models_dir = project_root / "model" / "models"
    models_dir.mkdir(parents=True, exist_ok=True)

    files_to_download = [
        "medgemma-4b-it-Q6_K.gguf",
        "mmproj-F16.gguf",
    ]

    for filename in files_to_download:
        target_path = models_dir / filename
        if target_path.exists():
            print(f"Skipping {filename} - already exists")
            continue

        print(f"Downloading {filename}...")
        hf_hub_download(
            repo_id=repo_id,
            filename=filename,
            token=hf_token,
            local_dir=models_dir,
            local_dir_use_symlinks=False,
        )
        print(f"Downloaded {filename} to {models_dir}")


if __name__ == "__main__":
    main()
