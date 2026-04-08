import re
import json

def parse_players():
    players = []
    
    with open('pdf_sample.txt', 'r', encoding='utf-8') as f:
        lines = f.readlines()
        
    for line in lines:
        role_search = re.search(r'(BATTER|BOWLER|WICKETKEEPER|ALL-ROUNDER)', line)
        price_search = re.search(r'(Capped|Uncapped)(\d+)', line)
        if role_search and price_search:
            role = role_search.group(1).title()
            if role == 'Wicketkeeper': role = 'Wicket-Keeper'
            
            base_price_lakhs = int(price_search.group(2))
            
            countries = ['India', 'England', 'South Africa', 'New Zealand', 'Australia', 'West Indies', 'Sri Lanka', 'Bangladesh', 'Afghanistan', 'Zimbabwe', 'Ireland']
            
            # Step 1: Remove leading ID and Set info
            # e.g., "1 1 M1 Jos Buttler England..." or "133 BA1 Harry BrookEngland..."
            # Usually leads with numbers, maybe spaces, then alphanumeric codes of length 2-4 like M1/BA1/UBA2
            clean = re.sub(r'^\d+\s*[a-zA-Z0-9]*\s*[a-zA-Z0-9]*\s+', '', line)
            
            country_match = re.search(r'(' + '|'.join(countries) + r')', clean)
            
            if country_match:
                name = clean[:country_match.start()].strip()
                if name:
                    players.append({
                        "name": name,
                        "role": role,
                        "base_price": base_price_lakhs
                    })

    seen = set()
    unique = []
    for p in players:
        if p["name"] not in seen:
            seen.add(p["name"])
            p["id"] = str(len(unique) + 1)
            unique.append(p)

    with open('frontend/src/data/players.json', 'w', encoding='utf-8') as out:
        json.dump(unique, out, indent=4)
        
    print(f"Generated {len(unique)} players")

if __name__ == "__main__":
    parse_players()
