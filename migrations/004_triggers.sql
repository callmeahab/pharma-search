-- Migration: 004_triggers
-- Database triggers for automatic updates

-- Trigger: update Vendor.updatedAt on change
DROP TRIGGER IF EXISTS update_vendor_updated_at ON public."Vendor";
CREATE TRIGGER update_vendor_updated_at
    BEFORE UPDATE ON public."Vendor"
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger: update Product.updatedAt on change
DROP TRIGGER IF EXISTS update_product_updated_at ON public."Product";
CREATE TRIGGER update_product_updated_at
    BEFORE UPDATE ON public."Product"
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();
