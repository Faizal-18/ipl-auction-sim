import pdfplumber
import json

def parse_pdf():
    players = []
    
    with pdfplumber.open("1731674068078_TATA IPL 2025- Auction List -15.11.24.pdf") as pdf:
        for page in pdf.pages:
            tables = page.extract_tables()
            for table in tables:
                for row in table:
                    # Looking at headers, we expect:
                    # [0]: List Sr.No.
                    # [1]: Set No.
                    # [2]: 2025 Set
                    # [3]: First Name
                    # [4]: Surname
                    # [5]: Country
                    # ...
                    # [20]: Reserve Price Rs Lakh
                    if len(row) > 10 and str(row[0]).strip().isdigit():
                        try:
                            # row[3] might be First Name + \n + Surname?
                            first_name = str(row[3]).strip().replace('\n', ' ')
                            surname = str(row[4]).strip().replace('\n', ' ') if row[4] else ""
                            name = f"{first_name} {surname}".strip()
                            role = str(row[8]).title().strip() if len(row) > 8 else "Unknown"
                            
                            # Normalize Role
                            if 'Batter' in role: role = 'Batter'
                            if 'Bowler' in role: role = 'Bowler'
                            if 'All-Rounder' in role: role = 'All-Rounder'
                            if 'Wicketkeeper' in role or 'Wicket Keeper' in role: role = 'Wicket-Keeper'
                            
                            # The reserve price is usually row[-1]
                            price_str = str(row[-1]).strip()
                            base_price = 0
                            if price_str.isdigit():
                                base_price = int(price_str)
                            
                            # Calculate if overseas
                            country = str(row[5]).strip() if len(row) > 5 else "Unknown"
                            is_overseas = country != "India" and "India" not in country

                            if name and base_price > 0:
                                players.append({
                                    "id": str(len(players) + 1),
                                    "name": name,
                                    "role": role,
                                    "is_overseas": is_overseas,
                                    "base_price": base_price
                                })
                        except Exception as e:
                            print("Error parsing row:", row, e)

    with open('frontend/src/data/players.json', 'w', encoding='utf-8') as out:
        json.dump(players, out, indent=4)
        
    print(f"Extracted {len(players)} players via pdfplumber")

if __name__ == "__main__":
    parse_pdf()
