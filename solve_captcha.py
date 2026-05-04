import ddddocr
import sys
from PIL import Image, ImageFilter, ImageEnhance
import io

def preprocess(path):
    img = Image.open(path).convert('L')
    img = img.resize((img.width * 2, img.height * 2), Image.LANCZOS)
    img = ImageEnhance.Contrast(img).enhance(2.0)
    img = img.filter(ImageFilter.SHARPEN)
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return buf.getvalue()

ocr = ddddocr.DdddOcr(show_ad=False)
image_bytes = preprocess(sys.argv[1])
result = ocr.classification(image_bytes)
digits = ''.join(c for c in result if c.isdigit())[:4]
print(digits)