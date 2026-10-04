import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

export default function BarcodePreview({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = '';
    if (!value) return;
    try {
      // EAN-13 إن كان 13 رقماً وصحيحاً، وإلا CODE128 لأي نص آخر
      JsBarcode(el, value, { format: /^\d{13}$/.test(value) ? 'EAN13' : 'CODE128', height: 50, displayValue: true });
    } catch {
      try {
        JsBarcode(el, value, { format: 'CODE128', height: 50, displayValue: true });
      } catch {
        /* قيمة غير قابلة للترميز */
      }
    }
  }, [value]);

  return <svg ref={ref} style={{ maxWidth: '100%' }} />;
}