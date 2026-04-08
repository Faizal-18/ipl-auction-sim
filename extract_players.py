import pypdf
import json

file_path = '1731674068078_TATA IPL 2025- Auction List -15.11.24.pdf'

try:
    with open(file_path, "rb") as f:
        reader = pypdf.PdfReader(f)
        text = ""
        # just read first 5 pages to understand format
        for i in range(min(5, len(reader.pages))):
            text += reader.pages[i].extract_text() + "\n---PAGE---\n"
        
    with open('pdf_sample.txt', 'w', encoding='utf-8') as f:
        f.write(text)
    print("Done generating sample")
except Exception as e:
    print(f"Error: {e}")
