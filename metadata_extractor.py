import os
import json
from datetime import datetime
from pathlib import Path
from PIL import Image, ImageOps
from PIL.ExifTags import TAGS, GPSTAGS, IFD
from PIL.PngImagePlugin import PngImageFile
from PIL.JpegImagePlugin import JpegImageFile
import folder_paths

CONFIG_INDENT = 4  # Assuming a default indent value if CONFIG is not available


def get_size(file_path):
    file_size_bytes = os.path.getsize(file_path)
    if file_size_bytes < 1024:
        return f"{file_size_bytes} bytes"
    elif file_size_bytes < 1024 * 1024:
        return f"{file_size_bytes / 1024:.2f} KB"
    else:
        return f"{file_size_bytes / (1024 * 1024):.2f} MB"


def decode_user_comment(raw: bytes) -> str | None:
    """Decode an EXIF UserComment binary blob per the EXIF 2.3 spec.

    The first 8 bytes are a character-code identifier:
      b'UNICODE\\x00\\x00' → UTF-16 BE (big-endian, no BOM)
      b'ASCII\\x00\\x00\\x00'  → ASCII / UTF-8
      b'JIS\\x00\\x00\\x00\\x00\\x00' → ISO-2022-JP

    Returns the decoded string, or None if decoding fails.
    """
    if not isinstance(raw, bytes) or len(raw) < 8:
        return None
    prefix = raw[:8]
    payload = raw[8:]
    if prefix.startswith(b'UNICODE'):
        try:
            return payload.decode('utf-16-be').rstrip('\x00')
        except UnicodeDecodeError:
            pass
    if prefix.startswith(b'ASCII'):
        try:
            return payload.decode('ascii').rstrip('\x00').rstrip('\x00')
        except UnicodeDecodeError:
            pass
    if prefix.startswith(b'JIS'):
        try:
            return payload.decode('iso-2022-jp').rstrip('\x00')
        except UnicodeDecodeError:
            pass
    # Fallback: attempt UTF-8 on the full payload
    try:
        return payload.decode('utf-8').rstrip('\x00')
    except UnicodeDecodeError:
        return None


def buildMetadata(image_path):
    if not Path(image_path).is_file():
        raise FileNotFoundError(f"File not found: {image_path}")

    img = Image.open(image_path)
    metadata = {}
    prompt = {}

    metadata["fileinfo"] = {
        "filename": Path(image_path).as_posix(),
        "resolution": f"{img.width}x{img.height}",
        "date": str(datetime.fromtimestamp(os.path.getmtime(image_path))),
        "size": str(get_size(image_path)),
    }

    # only for png files
    if isinstance(img, PngImageFile):
        metadataFromImg = img.info

        # for all metadataFromImg convert to string (but not for workflow and prompt!)
        for k, v in metadataFromImg.items():
            # from ComfyUI
            if k == "workflow":
                if isinstance(v, str): # Check if v is a string before attempting json.loads
                    try:
                        metadata["workflow"] = json.loads(v)
                    except json.JSONDecodeError as e:
                        print(f"Warning: Error parsing metadataFromImg 'workflow' as JSON, keeping as string: {e}")
                        metadata["workflow"] = v # Keep as string if parsing fails
                else:
                    metadata["workflow"] = v # If not a string, keep as is (might already be parsed)

            # from ComfyUI
            elif k == "prompt":
                if isinstance(v, str): # Check if v is a string before attempting json.loads
                    try:
                        metadata["prompt"] = json.loads(v)
                        prompt = metadata["prompt"] # extract prompt to use on metadata
                    except json.JSONDecodeError as e:
                        print(f"Warning: Error parsing metadataFromImg 'prompt' as JSON, keeping as string: {e}")
                        metadata["prompt"] = v # Keep as string if parsing fails
                else:
                    metadata["prompt"] = v # If not a string, keep as is (might already be parsed)

            else:
                if isinstance(v, str): # Check if v is a string before attempting json.loads
                    try:
                        metadata[str(k)] = json.loads(v)
                    except json.JSONDecodeError as e:
                        # print(f"Debug: Error parsing {k} as JSON, trying as string: {e}")
                        metadata[str(k)] = v # Keep as string if parsing fails
                else:
                    metadata[str(k)] = v # If not a string, keep as is

    if isinstance(img, JpegImageFile):
        exif = img.getexif()

        for k, v in exif.items():
            tag = TAGS.get(k, k)
            if v is not None:
                try:
                    metadata[str(tag)] = str(v)
                except Exception as e:
                    print(f"Warning: Error converting EXIF tag {tag} to string: {e}")
                    metadata[str(tag)] = "Error decoding value" # Handle encoding errors

        for ifd_id in IFD:
            try:
                if ifd_id == IFD.GPSInfo:
                    resolve = GPSTAGS
                else:
                    resolve = TAGS

                ifd = exif.get_ifd(ifd_id)
                ifd_name = str(ifd_id.name)
                metadata[ifd_name] = {}

                for k, v in ifd.items():
                    tag = resolve.get(k, k)
                    # UserComment (tag 37510) is a binary blob with an 8-byte charset prefix.
                    # Decode it properly instead of calling str() on the raw bytes.
                    if k == 37510 and isinstance(v, bytes):
                        decoded = decode_user_comment(v)
                        if decoded is not None:
                            metadata[ifd_name][str(tag)] = decoded
                            # Promote to top-level parameters if it looks like A1111 format
                            # and no parameters key was already set (PNG chunk takes priority).
                            if 'Steps:' in decoded and ('Sampler:' in decoded or 'Model:' in decoded):
                                metadata.setdefault('parameters', decoded)
                        continue
                    try:
                        metadata[ifd_name][str(tag)] = str(v)
                    except Exception as e:
                        print(f"Warning: Error converting EXIF IFD tag {tag} to string: {e}")
                        metadata[ifd_name][str(tag)] = "Error decoding value" # Handle encoding errors


            except KeyError:
                pass


    return img, prompt, metadata


def buildPreviewText(metadata):
    text = f"File: {metadata['fileinfo']['filename']}\n"
    text += f"Resolution: {metadata['fileinfo']['resolution']}\n"
    text += f"Date: {metadata['fileinfo']['date']}\n"
    text += f"Size: {metadata['fileinfo']['size']}\n"
    return text