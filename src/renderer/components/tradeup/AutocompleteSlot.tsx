/**
 * AutocompleteSlot — single trade-up item slot.
 * - Fuzzy Chinese name match (wear suffixes stripped)
 * - Auto-lock when exact match found
 * - Wear input validation (minFloat ≤ w ≤ maxFloat)
 */
import React, { useState, useEffect, useRef } from 'react';
import { Input, AutoComplete, Typography, Space } from 'antd';
import { useTradeUpStore, type TradeUpSlotItem } from '../../stores/useTradeUpStore';

const { Text } = Typography;

// Strip wear suffixes like " (崭新出厂)", " (Factory New)", etc.
function stripWear(name: string): string {
  return name.replace(/\s*[（(][^)）]*[)）]\s*$/g, '').trim();
}

interface AutocompleteSlotProps { index: number; }

const AutocompleteSlot: React.FC<AutocompleteSlotProps> = ({ index }) => {
  const { slots, setSlot, removeSlot } = useTradeUpStore();
  const item = slots[index];
  const [options, setOptions] = useState<any[]>([]);
  const [searchText, setSearchText] = useState('');
  const [wearInput, setWearInput] = useState(item ? String(item.wearFloat) : '');
  const autoLockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wearError = item && (parseFloat(wearInput) < item.minFloat || parseFloat(wearInput) > item.maxFloat);

  useEffect(() => {
    if (item) {
      setSearchText(stripWear(item.nameZh || item.name));
      setWearInput(String(item.wearFloat > 0 ? item.wearFloat : ''));
    }
  }, [item]);

  const handleSearch = async (value: string) => {
    setSearchText(value);
    if (value.length < 1) { setOptions([]); return; }
    try {
      const results: any[] = await (window.electronAPI as any).autocomplete?.(value) || [];
      const opts = results.map((s: any) => ({
        value: stripWear(s.nameZh),
        label: `${stripWear(s.nameZh)} [${s.minFloat.toFixed(2)}-${s.maxFloat.toFixed(2)}] ${s.rarity}`,
        data: s,
      }));
      setOptions(opts);

      // Auto-lock: if exact match found, select immediately
      const exact = opts.find(o => o.value === value.trim());
      if (exact) {
        applySlot(exact.data);
        setOptions([]);
      }
    } catch { setOptions([]); }
  };

  const applySlot = (data: any) => {
    const newItem: TradeUpSlotItem = {
      assetId: '', name: data.name, nameZh: stripWear(data.nameZh),
      paintIndex: Number(data.paintIndex), weaponId: data.weaponId,
      rarity: data.rarity, rarityColor: data.rarityColor,
      wearFloat: 0, minFloat: data.minFloat, maxFloat: data.maxFloat,
      collection: data.collection, imageUrl: data.imageUrl,
      isStatTrak: false, isSouvenir: false,
    };
    setSlot(index, newItem);
    setWearInput('');
  };

  const handleSelect = (_value: string, option: any) => {
    applySlot(option.data);
    setOptions([]);
  };

  const handleWearChange = (value: string) => {
    // Allow: digits, one decimal point, leading zero
    const cleaned = value.replace(/[^0-9.]/g, '');
    // Only allow one decimal point
    const parts = cleaned.split('.');
    const fixed = parts.length > 2 ? parts[0] + '.' + parts.slice(1).join('') : cleaned;
    setWearInput(fixed);
    const w = parseFloat(fixed);
    if (item && !isNaN(w) && w >= item.minFloat && w <= item.maxFloat) {
      setSlot(index, { ...item, wearFloat: w });
    }
  };

  return (
    <div style={{
      width: 180, padding: 10, border: '1px solid #d9d9d9', borderRadius: 8,
      background: item ? (item.rarityColor || '#888') + '12' : '#fafafa',
      minHeight: 120,
    }}>
      <AutoComplete
        value={searchText}
        options={options}
        onSearch={handleSearch}
        onSelect={handleSelect}
        onClear={() => { setSearchText(''); setWearInput(''); removeSlot(index); }}
        allowClear
        style={{ width: '100%' }}
        placeholder={`槽 ${index + 1}`}
      />
      {item && (
        <Space direction="vertical" size={2} style={{ width: '100%', marginTop: 6 }}>
          <Text style={{ fontSize: 11, color: item.rarityColor }} ellipsis>
            {item.nameZh || item.name}
          </Text>
          <Text type="secondary" style={{ fontSize: 9 }}>
            磨损: {item.minFloat.toFixed(2)} ~ {item.maxFloat.toFixed(2)}
          </Text>
          <Input size="small" placeholder="输入磨损值"
            value={wearInput} onChange={(e) => handleWearChange(e.target.value)}
            status={wearError ? 'error' : undefined}
            style={{ fontSize: 12 }} />
          {wearError && (
            <Text type="danger" style={{ fontSize: 9 }}>
              超出合法范围 ({item.minFloat.toFixed(2)}–{item.maxFloat.toFixed(2)})
            </Text>
          )}
        </Space>
      )}
    </div>
  );
};

export default AutocompleteSlot;
