"""
Export routes for CSV downloads
"""
import csv
import io
from typing import Optional, List
from fastapi import HTTPException, Query, Response
from fastapi.responses import StreamingResponse
import logging

logger = logging.getLogger(__name__)


def register_export_routes(app, search_engine):
    """Register CSV export routes on the FastAPI app"""
    
    @app.get("/api/export/csv")
    async def export_search_results_csv(
        q: str = Query(..., description="Search query"),
        limit: int = Query(1000, ge=1, le=5000),
        min_price: Optional[float] = Query(None),
        max_price: Optional[float] = Query(None),
        vendor_ids: Optional[List[str]] = Query(None),
        brand_ids: Optional[List[str]] = Query(None),
    ):
        """Export search results to CSV format
        
        Args:
            q: Search query
            limit: Maximum number of results (up to 5000 for exports)
            min_price: Minimum price filter
            max_price: Maximum price filter  
            vendor_ids: Filter by vendor IDs
            brand_ids: Filter by brand IDs
        """
        try:
            # Build filters
            filters = {}
            if min_price is not None:
                filters["min_price"] = min_price
            if max_price is not None:
                filters["max_price"] = max_price
            if vendor_ids:
                filters["vendor_ids"] = vendor_ids
            if brand_ids:
                filters["brand_ids"] = brand_ids
            
            # Search for products
            results = await search_engine.search(
                query=q,
                filters=filters if filters else None,
                group_results=False,  # Get individual products for CSV export
                limit=limit,
                offset=0,
                force_db_search=True,  # Use database search for consistent CSV output
            )
            
            if not results.get("products"):
                raise HTTPException(status_code=404, detail="No products found")
            
            # Create CSV content
            output = io.StringIO()
            writer = csv.writer(output)
            
            # Write CSV headers
            headers = [
                "ID", "Title", "Price", "Vendor", "Brand", "Category", 
                "Link", "Thumbnail", "Description"
            ]
            writer.writerow(headers)
            
            # Write product data
            for product in results["products"]:
                row = [
                    product.get("id", ""),
                    product.get("title", ""),
                    product.get("price", ""),
                    product.get("vendor_name", ""),
                    product.get("brand_name", ""),
                    product.get("category", ""),
                    product.get("link", ""),
                    product.get("thumbnail", ""),
                    product.get("description", "")
                ]
                writer.writerow(row)
            
            # Prepare CSV response
            csv_content = output.getvalue()
            output.close()
            
            # Create filename
            safe_query = "".join(c for c in q if c.isalnum() or c in (' ', '-', '_')).strip()
            filename = f"pharma_search_{safe_query[:30]}.csv"
            
            # Return CSV file
            return Response(
                content=csv_content,
                media_type="text/csv",
                headers={
                    "Content-Disposition": f"attachment; filename={filename}"
                }
            )
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"CSV export error: {e}")
            raise HTTPException(status_code=500, detail="CSV export failed")
    
    @app.get("/api/export/products-csv")
    async def export_all_products_csv(
        limit: int = Query(10000, ge=1, le=50000),
        vendor_id: Optional[str] = Query(None),
    ):
        """Export all products to CSV (or filtered by vendor)
        
        Args:
            limit: Maximum number of products to export
            vendor_id: Optional vendor ID filter
        """
        try:
            async with search_engine.pool.acquire() as conn:
                # Build query
                query = '''
                    SELECT 
                        p.id, p.title, p.price, p.category, p.link, 
                        p.thumbnail, p.description,
                        v.name as vendor_name,
                        b.name as brand_name
                    FROM "Product" p
                    LEFT JOIN "Vendor" v ON v.id = p."vendorId"
                    LEFT JOIN "Brand" b ON b.id = p."brandId"
                '''
                
                params = []
                if vendor_id:
                    query += ' WHERE p."vendorId" = $1'
                    params.append(vendor_id)
                
                query += ' ORDER BY p."createdAt" DESC LIMIT $' + str(len(params) + 1)
                params.append(limit)
                
                # Execute query
                rows = await conn.fetch(query, *params)
                
                if not rows:
                    raise HTTPException(status_code=404, detail="No products found")
                
                # Create CSV content
                output = io.StringIO()
                writer = csv.writer(output)
                
                # Write headers
                headers = [
                    "ID", "Title", "Price", "Category", "Link", "Thumbnail", 
                    "Description", "Vendor", "Brand"
                ]
                writer.writerow(headers)
                
                # Write data
                for row in rows:
                    csv_row = [
                        row["id"],
                        row["title"],
                        row["price"],
                        row["category"] or "",
                        row["link"] or "",
                        row["thumbnail"] or "",
                        row["description"] or "",
                        row["vendor_name"] or "",
                        row["brand_name"] or "",
                    ]
                    writer.writerow(csv_row)
                
                csv_content = output.getvalue()
                output.close()
                
                # Create filename
                if vendor_id:
                    filename = f"products_vendor_{vendor_id}.csv"
                else:
                    filename = "all_products.csv"
                
                return Response(
                    content=csv_content,
                    media_type="text/csv",
                    headers={
                        "Content-Disposition": f"attachment; filename={filename}"
                    }
                )
                
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Products CSV export error: {e}")
            raise HTTPException(status_code=500, detail="Products CSV export failed")

    logger.info("Export routes registered successfully")