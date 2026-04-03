#!/usr/bin/env python3
"""
Quick database clear script - drops all satellites and debris
"""
import argparse
import json
import urllib.request

def clear_database(api_url: str):
    """Clear database collections via Go adapter"""
    print(f"Attempting to clear database via Go adapter...")
    
    # Use the Go adapter's clear endpoint
    try:
        req = urllib.request.Request(
            "http://localhost:8080/clear",
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
            print(f"✅ Database cleared successfully: {result}")
            return True
    except Exception as e:
        print(f"❌ Failed to clear database: {e}")
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
        print("1. Connect to MongoDB")
        print("2. Navigate to acm_db database")
        print("3. Drop 'satellites' and 'debris' collections")
        print("4. Run: python seed_satellites.py")
        print("\nOR just run seed_clean_database.py - it will overwrite existing data.")

if __name__ == "__main__":
    main()
