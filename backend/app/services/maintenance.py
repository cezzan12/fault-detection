from datetime import datetime
import logging
from app.database import get_database

logger = logging.getLogger(__name__)

async def fix_missing_dates():
    """
    Scans the machines collection for documents missing the 'date' field.
    Derives 'date' from 'dataUpdatedTime' and updates the document.
    """
    try:
        db = get_database()
        if db is None:
            logger.warning("Database not connected, skipping date fix.")
            return

        machines_collection = db.machines
        
        # Find documents where 'date' field is missing
        query = {"date": {"$exists": False}}
        count = await machines_collection.count_documents(query)
        
        if count == 0:
            logger.info("✅ Data consistency check passed: All machines have 'date' field.")
            return

        logger.info(f"🔧 Found {count} machines with missing 'date' field. Starting fix...")
        
        cursor = machines_collection.find(query)
        fixed_count = 0
        
        async for machine in cursor:
            data_time = machine.get("dataUpdatedTime")
            if not data_time or data_time == "N/A":
                continue

            try:
                # Try to parse date from dataUpdatedTime
                # Formats seen: "Wed, 24 Dec 2025 05:48:22 GMT" or "2025-12-24T..."
                parsed_date = None
                
                # Method 1: Try slicing if it looks like ISO or YYYY-MM-DD
                if len(data_time) >= 10 and data_time[0:4].isdigit() and data_time[4] == '-':
                    parsed_date = data_time[:10]
                else:
                    # Method 2: Try parsing standard formats
                    from email.utils import parsedate_to_datetime
                    dt_obj = parsedate_to_datetime(data_time)
                    parsed_date = dt_obj.strftime("%Y-%m-%d")

                if parsed_date:
                    try:
                        await machines_collection.update_one(
                            {"_id": machine["_id"]},
                            {"$set": {"date": parsed_date}}
                        )
                        fixed_count += 1
                    except Exception as e:
                        # Check for unauthorized error
                        if hasattr(e, 'code') and e.code == 13:
                             logger.warning("⚠️ Unauthorized to update machine data. Database is likely read-only.")
                             break
                        logger.debug(f"Failed to update date for machine {machine.get('_id')}: {e}")
                        continue
            except Exception as e:
                logger.debug(f"Failed to parse date for machine {machine.get('_id')}: {e}")
                continue
                
        if fixed_count > 0:
            logger.info(f"✅ Fixed 'date' field for {fixed_count} machines.")
        else:
            logger.info("ℹ️ No machines were updated (either none needed fixing or read-only mode).")

    except Exception as e:
        logger.error(f"Error during date fix maintenance: {e}")
