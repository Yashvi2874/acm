#!/usr/bin/env python3
"""
Quick database clear script - drops all satellites and debris
"""
import argparse
import json
import urllib.request

def clear_database(api_url: str):
    """Clear via upserting empty batch (workaround until admin endpoint deployed)"""
    # First, let's just overwrite by seeding fresh data
    print(f"Attempting to clear via direct MongoDB access...")
    
    # Try the admin endpoint first
    try:
        req = urllib.request.Request(
            f"{api_url}/api/admin/clear",
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read())
            print(f"✅ Cleared via admin endpoint: {result}")
            return True
    except Exception as e:
        print(f"⚠️  Admin endpoint not available ({e})")
        print("   Will use workaround method...")
        return False

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default="http://localhost:8000")
    args = parser.parse_args()
    
    print("=" * 70)
    print("DATABASE CLEAR UTILITY")
    print("=" * 70)
    
    success = clear_database(args.api)
    
    if success:
        print("\n✅ Database cleared successfully!")
        print("Run seed_clean_database.py to populate with fresh data.")
    else:
        print("\n⚠️  Could not clear database automatically.")
        print("\nManual workaround:")
        print("1. Connect to MongoDB Atlas UI")
        print("2. Navigate to nsh_debris database")
        print("3. Drop 'satellites' and 'debris' collections")
        print("4. Run: python seed_clean_database.py --api http://localhost:8000")
        print("\nOR just run seed_clean_database.py - it will overwrite existing data.")

if __name__ == "__main__":
    main()
