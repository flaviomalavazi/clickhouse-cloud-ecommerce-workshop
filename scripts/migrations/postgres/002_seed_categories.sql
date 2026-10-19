INSERT INTO categories (slug, name, description, banner_url) VALUES
    ('shoes',          'Shoes',          'Footwear for every occasion, from sports to formal', '/images/hero/shoes.jpg'),
    ('clothing',       'Clothing',       'Apparel for men, women and kids across all seasons', '/images/hero/clothing.jpg'),
    ('books',          'Books',          'Fiction, non-fiction, technical and educational titles', '/images/hero/books.jpg'),
    ('it-accessories', 'IT Accessories', 'Keyboards, mice, cables, hubs and peripherals', '/images/hero/it-accessories.jpg'),
    ('electronics',    'Electronics',    'TVs, audio equipment, cameras and home gadgets', '/images/hero/electronics.jpg')
ON CONFLICT (slug) DO NOTHING;
