-- Official mapping: name clean, code separate (schema dro)

truncate table dro.offices restart identity cascade;

insert into dro.offices (office_type, code, name, parent_code, region_code, division_code, consumer_count) values
  ('zone', '34', 'Siliguri Zone', null, null, null, 0),
  ('region', '341', 'Darjeeling Region', '34', '341', null, 563074),
  ('division', '3412', 'Siliguri Town', '341', '341', '3412', 239624),
  ('division', '3413', 'Kurseong', '341', '341', '3413', 48309),
  ('division', '3414', 'Darjeeling', '341', '341', '3414', 74099),
  ('division', '3415', 'Siliguri Sub Urban', '341', '341', '3415', 215978);

insert into dro.offices (office_type, code, name, parent_code, region_code, division_code, consumer_count) values
  ('ccc', '3412400', 'Milanpally', '3412', '341', '3412', 37416),
  ('ccc', '3412401', 'NJP Gate Bazar', '3412', '341', '3412', 30591),
  ('ccc', '3412501', 'Subhaspally', '3412', '341', '3412', 41523),
  ('ccc', '3412502', 'Hakimpara', '3412', '341', '3412', 28199),
  ('ccc', '3412503', 'Power House', '3412', '341', '3412', 45862),
  ('ccc', '3412504', 'Pradhan Nagar', '3412', '341', '3412', 44846),
  ('ccc', '3412505', 'Siliguri Town', '3412', '341', '3412', 11187),
  ('ccc', '3413101', 'Sonada', '3413', '341', '3413', 10265),
  ('ccc', '3413201', 'Mirik', '3413', '341', '3413', 13143),
  ('ccc', '3413202', 'Kurseong', '3413', '341', '3413', 24901),
  ('ccc', '3414101', 'Sukhiapokhri', '3414', '341', '3414', 12779),
  ('ccc', '3414102', 'Takdah', '3414', '341', '3414', 14394),
  ('ccc', '3414201', 'Bijanbari', '3414', '341', '3414', 14549),
  ('ccc', '3414300', 'Darjeeling', '3414', '341', '3414', 32377),
  ('ccc', '3415101', 'Naxalbari', '3415', '341', '3415', 34854),
  ('ccc', '3415102', 'Phansidewa', '3415', '341', '3415', 28282),
  ('ccc', '3415103', 'Kharibari', '3415', '341', '3415', 32646),
  ('ccc', '3415200', 'Bagdogra', '3415', '341', '3415', 22711),
  ('ccc', '3415201', 'Bidhannagar', '3415', '341', '3415', 20150),
  ('ccc', '3415400', 'Matigara', '3415', '341', '3415', 44517),
  ('ccc', '3415600', 'Shivmandir', '3415', '341', '3415', 32818);
