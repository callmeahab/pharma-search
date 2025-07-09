import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, RefreshCw, Database, Search, Settings, AlertTriangle, CheckCircle } from 'lucide-react';
import { processProducts, reprocessAllProducts, rebuildSearchIndex } from '@/lib/api';

interface AdminOperationsProps {
  className?: string;
}

export const AdminOperations: React.FC<AdminOperationsProps> = ({ className }) => {
  const [batchSize, setBatchSize] = useState(100);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isReprocessing, setIsReprocessing] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleProcessProducts = async () => {
    try {
      setIsProcessing(true);
      setMessage(null);
      const result = await processProducts(batchSize);
      setMessage({ type: 'success', text: result.message });
    } catch (error) {
      setMessage({ 
        type: 'error', 
        text: error instanceof Error ? error.message : 'Processing failed' 
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReprocessAll = async () => {
    try {
      setIsReprocessing(true);
      setMessage(null);
      const result = await reprocessAllProducts();
      setMessage({ type: 'success', text: result.message });
    } catch (error) {
      setMessage({ 
        type: 'error', 
        text: error instanceof Error ? error.message : 'Reprocessing failed' 
      });
    } finally {
      setIsReprocessing(false);
    }
  };

  const handleRebuildIndex = async () => {
    try {
      setIsRebuilding(true);
      setMessage(null);
      const result = await rebuildSearchIndex();
      setMessage({ type: 'success', text: result.message });
    } catch (error) {
      setMessage({ 
        type: 'error', 
        text: error instanceof Error ? error.message : 'Index rebuild failed' 
      });
    } finally {
      setIsRebuilding(false);
    }
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          Admin Operations
        </CardTitle>
        <CardDescription>
          Manage product processing and search index operations
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {message && (
          <Alert variant={message.type === 'error' ? 'destructive' : 'default'}>
            {message.type === 'error' ? (
              <AlertTriangle className="h-4 w-4" />
            ) : (
              <CheckCircle className="h-4 w-4" />
            )}
            <AlertDescription>{message.text}</AlertDescription>
          </Alert>
        )}

        {/* Process Products */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            <h3 className="font-semibold">Process Products</h3>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Process products in batches to update grouping and normalize data.
          </p>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <Label htmlFor="batch-size">Batch Size</Label>
              <Input
                id="batch-size"
                type="number"
                min="10"
                max="1000"
                value={batchSize}
                onChange={(e) => setBatchSize(Number(e.target.value))}
                className="mt-1"
              />
            </div>
            <Button
              onClick={handleProcessProducts}
              disabled={isProcessing}
              className="mt-6"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Processing...
                </>
              ) : (
                <>
                  <Database className="h-4 w-4 mr-2" />
                  Process Products
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Reprocess All Products */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            <h3 className="font-semibold">Reprocess All Products</h3>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Reprocess all products with enhanced grouping. This will clear existing groups and rebuild them.
          </p>
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              This operation will clear all existing product groups and rebuild them from scratch. Use with caution.
            </AlertDescription>
          </Alert>
          <Button
            onClick={handleReprocessAll}
            disabled={isReprocessing}
            variant="outline"
          >
            {isReprocessing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Reprocessing...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Reprocess All
              </>
            )}
          </Button>
        </div>

        {/* Rebuild Search Index */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4" />
            <h3 className="font-semibold">Rebuild Search Index</h3>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Force rebuild of the search index. This ignores the cache and rebuilds from scratch.
          </p>
          <Button
            onClick={handleRebuildIndex}
            disabled={isRebuilding}
            variant="secondary"
          >
            {isRebuilding ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Rebuilding...
              </>
            ) : (
              <>
                <Search className="h-4 w-4 mr-2" />
                Rebuild Index
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};