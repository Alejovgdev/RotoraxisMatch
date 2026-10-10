-- Storage's download gateway checks object information before serving private
-- images. The 098 policy omitted that operation, so valid downloads returned
-- NoSuchKey. Allow GET-info and HEAD-info under the SAME identity/owner gates.
-- No public reads, signed URLs, new identity rule or changes to write policies.
ALTER POLICY technician_photo_read ON storage.objects USING (
  bucket_id='technician-photos' AND (
    (storage.allow_any_operation(ARRAY[
      'object.get_authenticated',
      'object.get_authenticated_info',
      'object.head_authenticated_info'
    ]) AND public.can_read_technician_photo(name))
    OR (storage.allow_any_operation(ARRAY[
      'object.get_authenticated',
      'object.get_authenticated_info',
      'object.head_authenticated_info',
      'object.upload','object.list','object.list_v2','object.delete','object.delete_many'
    ]) AND public.owns_technician_photo(name))
  )
);
