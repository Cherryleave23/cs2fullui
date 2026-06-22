/**
 * AutocompleteSlot — single trade-up item slot.
 * User types Chinese skin name → AutoComplete fuzzy matches.
 * Shows valid wear range when item selected.
 */
import React, { useState, useEffect, useMemo } from 'react';
import { Input, AutoComplete, Typography, Space } from 'antd';
import { useTradeUpStore, type TradeUpSlotItem } from '../../stores/useTradeUpStore';

const { Text } = Typography;

interface SkinOption {
  value: string;
  label: string;
  data: {
    paintIndex: string; weaponId: number; minFloat: number; maxFloat: number;
    collection: string; rarity: string; rarityColor: string; imageUrl: string;
  };
}

interface AutocompleteSlotProps {
  index: number;
}

const AutocompleteSlot: React.FC<AutocompleteSlotProps> = ({ index }) => {
  const { slots, setSlot, removeSlot } = useTradeUpStore();
  const item = slots[index];
  const [options, setOptions] = useState<SkinOption[]>([]);
  const [searchText, setSearchText] = useState('');
  const [wearInput, setWearInput] = useState(item ? String(item.wearFloat) : '');

  useEffect(() => {
    if (item) {
      setSearchText(item.nameZh || item.name);
      setWearInput(String(item.wearFloat));
    }
  }, [item]);

  const handleSearch = async (value: string) => {
    setSearchText(value);
    if (value.length < 1) { setOptions([]); return; }
    try {
      const results: any[] = await (window.electronAPI as any).autocomplete?.(value) || [];
      setOptions(results.map((s: any) => ({
        value: s.nameZh,
        label: `${s.nameZh} [${s.minFloat.toFixed(2)}-${s.maxFloat.toFixed(2)}] ${s.rarity}`,
        data: s,
      })));
    } catch { setOptions([]); }
  };

  const handleSelect = (value: string, option: any) => {
    const { data } = option;
    const newItem: TradeUpSlotItem = {
      assetId: '',
      name: data.name,
      nameZh: data.nameZh,
      paintIndex: Number(data.paintIndex),
      weaponId: data.weaponId,
      rarity: data.rarity,
      rarityColor: data.rarityColor,
      wearFloat: 0,
      minFloat: data.minFloat,
      maxFloat: data.maxFloat,
      collection: data.collection,
      imageUrl: data.imageUrl,
      isStatTrak: false,
      isSouvenir: false,
    };
    setSlot(index, newItem);
    setWearInput('');
  };

  const handleWearChange = (value: string) => {
    setWearInput(value);
    const w = parseFloat(value);
    if (item && !isNaN(w)) {
      setSlot(index, { ...item, wearFloat: w });
    }
  };

  const handleClear = () => {
    setSearchText('');
    setWearInput('');
    removeSlot(index);
  };

  return (
    <div style={{
      width: 160, padding: 8, border: '1px solid #d9d9d9', borderRadius: 8,
      background: item ? item.rarityColor + '10' : '#fafafa',
    }}>
      <AutoComplete
        value={searchText}
        options={options}
        onSearch={handleSearch}
        onSelect={handleSelect}
        onClear={handleClear}
        allowClear
        style={{ width: '100%' }}
        placeholder={`槽 ${index + 1}`}
        size="small"
      />
      {item && (
        <Space direction="vertical" size={2} style={{ width: '100%', marginTop: 4 }}>
          <Text style={{ fontSize: 10, color: item.rarityColor }} ellipsis>
            {item.nameZh || item.name}
          </Text>
          <Text type="secondary" style={{ fontSize: 9 }}>
            磨损范围: {item.minFloat.toFixed(2)} - {item.maxFloat.toFixed(2)}
          </Text>
          <Input
            size="small"
            placeholder="磨损值"
            value={wearInput}
            onChange={(e) => handleWearChange(e.target.value)}
            style={{ fontSize: 11 }}
          />
        </Space>
      )}
    </div>
  );
};

export default AutocompleteSlot;
